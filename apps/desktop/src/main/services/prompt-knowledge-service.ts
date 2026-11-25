import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type {
  PromptKnowledgeImportConflict,
  PromptKnowledgeImportPreview,
  PromptKnowledgeImportSkipped,
  PromptKnowledgeModuleLayer,
  PromptKnowledgeModulePreview,
  PromptKnowledgePackKind,
  PromptKnowledgePackPreview,
} from "@prompthub/shared/types";
import {
  dedupeKnowledgeModules,
  isSkippedKnowledgePath,
  knowledgeModuleSizeError,
  MAX_KNOWLEDGE_PACK_MODULES,
  resolveKnowledgeLayer,
} from "@prompthub/shared/utils/prompt-knowledge";
import { estimatePromptTokens } from "@prompthub/shared/utils/prompt-token-estimate";

const KNOWLEDGE_DIR = "知识";
const MAX_SCAN_DEPTH = 4;
const SCRIPT_EXTENSIONS = new Set([".py", ".js", ".mjs", ".ts", ".sh", ".ps1", ".bat", ".cmd"]);
const PACK_KINDS: ReadonlySet<string> = new Set(["skill", "knowledge", "preset", "reference"]);

interface Section {
  title: string;
  content: string;
}

interface Candidate {
  /** Path relative to the pack root, used for skip reports and keys. */
  relativePath: string;
  title: string;
  content: string;
  category?: string;
  scope?: string;
  priority?: "P0" | "P1" | "P2";
  triggers?: string[];
  dependsOn?: string[];
  /** Explicit `module:` frontmatter key, preferred over a derived key. */
  moduleKey?: string;
  /** Extra text (for example the first sub-heading) used to pick the layer. */
  layerHint?: string;
}

function hashText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function readText(filePath: string): string {
  return fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
}

/** Minimal YAML frontmatter reader: flat `key: value` pairs only. */
export function parseFrontmatter(text: string): {
  meta: Record<string, string>;
  body: string;
} {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return { meta: {}, body: normalized };
  const end = normalized.indexOf("\n---", 4);
  if (end < 0) return { meta: {}, body: normalized };
  const raw = normalized.slice(4, end);
  const bodyStart = normalized.indexOf("\n", end + 4);
  const meta: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line.trim());
    if (!match) continue;
    const value = match[2].trim().replace(/^["']|["']$/g, "");
    if (value) meta[match[1]] = value;
  }
  return { meta, body: bodyStart < 0 ? "" : normalized.slice(bodyStart + 1) };
}

/** Splits on level-2 headings while ignoring fenced code blocks. */
export function splitLevelTwoSections(markdown: string): Section[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const sections: Section[] = [];
  let title: string | null = null;
  let buffer: string[] = [];
  let fence = false;

  const flush = () => {
    if (title !== null) {
      const content = buffer.join("\n").trim();
      if (content) sections.push({ title: title.trim(), content });
    }
    buffer = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) fence = !fence;
    if (!fence && /^##\s+\S/.test(trimmed)) {
      flush();
      title = trimmed.replace(/^##\s+/, "");
      continue;
    }
    if (title !== null) buffer.push(line);
  }
  flush();
  return sections;
}

function firstHeadingTitle(body: string): string | null {
  const match = /^#\s+(.+)$/m.exec(body);
  return match ? match[1].trim() : null;
}

function moduleKeyFor(relativePath: string, title: string, content: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "module";
  return `${slug}-${hashText(`${relativePath}\n${title}\n${content}`).slice(0, 8)}`;
}

function priorityOf(title: string): "P0" | "P1" | "P2" | undefined {
  const match = /\b(P[0-2])\b/.exec(title);
  return match ? (match[1] as "P0" | "P1" | "P2") : undefined;
}

function scriptSkipped(relativePath: string): boolean {
  return SCRIPT_EXTENSIONS.has(path.extname(relativePath).toLowerCase());
}

function collectFiles(
  root: string,
  skipped: PromptKnowledgeImportSkipped[],
): { relativePath: string; absolutePath: string }[] {
  const found: { relativePath: string; absolutePath: string }[] = [];

  const walk = (absoluteDir: string, relativeDir: string, depth: number): void => {
    if (depth > MAX_SCAN_DEPTH) return;
    for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
      const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        const skip = isSkippedKnowledgePath(`${relativePath}/`);
        if (skip) {
          skipped.push({ path: relativePath, reason: skip });
          continue;
        }
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        walk(path.join(absoluteDir, entry.name), relativePath, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const skip = isSkippedKnowledgePath(relativePath);
      if (skip) {
        skipped.push({ path: relativePath, reason: skip });
        continue;
      }
      if (path.extname(entry.name).toLowerCase() === ".md") {
        found.push({ relativePath, absolutePath: path.join(absoluteDir, entry.name) });
      } else if (scriptSkipped(relativePath)) {
        skipped.push({
          path: relativePath,
          reason: "only markdown is imported; scripts are never executed",
        });
      }
    }
  };

  walk(root, "", 0);
  return found.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function sectionsToCandidates(
  sections: Section[],
  relativePath: string,
  category?: string,
): Candidate[] {
  return sections.map((section) => ({
    relativePath,
    title: section.title,
    content: section.content,
    ...(category ? { category } : {}),
  }));
}

function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[,，、]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function knowledgeCandidates(
  files: { relativePath: string; absolutePath: string }[],
  skipped: PromptKnowledgeImportSkipped[],
): Candidate[] {
  const candidates: Candidate[] = [];
  for (const file of files) {
    if (!file.relativePath.startsWith(`${KNOWLEDGE_DIR}/`)) continue;
    const parsed = parseFrontmatter(readText(file.absolutePath));
    const body = parsed.body.trim();
    if (!body) continue;
    if (parsed.meta.inject?.toLowerCase() === "false") {
      skipped.push({
        path: file.relativePath,
        reason: "module is marked inject: false and is not imported",
      });
      continue;
    }
    const parts = file.relativePath.split("/");
    const folder = parts.length > 2 ? parts[1] : undefined;
    const title =
      parsed.meta.name ??
      firstHeadingTitle(body) ??
      path.basename(file.relativePath, path.extname(file.relativePath));
    const priorityValue = parsed.meta.priority;
    const priority = priorityValue && /^P[0-2]$/.test(priorityValue)
      ? (priorityValue as "P0" | "P1" | "P2")
      : undefined;
    candidates.push({
      relativePath: file.relativePath,
      title,
      content: body,
      ...(parsed.meta.category ?? folder ? { category: parsed.meta.category ?? folder } : {}),
      ...(parsed.meta.scope ? { scope: parsed.meta.scope } : {}),
      ...(priority ? { priority } : {}),
      triggers: splitList(parsed.meta.triggers),
      dependsOn: splitList(parsed.meta.depends_on),
      ...(parsed.meta.module ? { moduleKey: parsed.meta.module } : {}),
      layerHint: `${folder ?? ""} ${body.slice(0, 300)}`,
    });
  }
  return candidates;
}

function modulePreview(
  candidate: Candidate,
  packName: string,
  skipped: PromptKnowledgeImportSkipped[],
): Omit<PromptKnowledgeModulePreview, "ord"> | null {
  const sizeError = knowledgeModuleSizeError(candidate.content);
  if (sizeError) {
    skipped.push({ path: candidate.relativePath, reason: `${packName}: ${sizeError}` });
    return null;
  }
  const priority = candidate.priority ?? priorityOf(candidate.title);
  const layer: PromptKnowledgeModuleLayer = resolveKnowledgeLayer(
    candidate.layerHint ? `${candidate.title} ${candidate.layerHint}` : candidate.title,
  );
  return {
    moduleKey:
      candidate.moduleKey ??
      moduleKeyFor(candidate.relativePath, candidate.title, candidate.content),
    title: candidate.title,
    ...(candidate.category ? { category: candidate.category } : {}),
    ...(candidate.scope ? { scope: candidate.scope } : {}),
    ...(priority ? { priority } : {}),
    layer,
    triggers: candidate.triggers ?? [],
    dependsOn: candidate.dependsOn ?? [],
    tokens: estimatePromptTokens(candidate.content),
    bytes: new TextEncoder().encode(candidate.content).byteLength,
    contentHash: hashText(candidate.content),
  };
}

/**
 * Scans one pack directory and returns what an import would write. Sources:
 * markdown under `知识/`, else level-2 sections of `index.md`, else the
 * level-2 sections of `SKILL.md`, else the whole SKILL.md body.
 */
export function previewKnowledgePack(rootPath: string): PromptKnowledgeImportPreview {
  const resolved = path.resolve(rootPath);
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) throw new Error(`Knowledge pack root is not a directory: ${resolved}`);

  const skipped: PromptKnowledgeImportSkipped[] = [];
  const files = collectFiles(resolved, skipped);
  const byRelative = new Map(files.map((file) => [file.relativePath, file]));

  const skillFile = byRelative.get("SKILL.md");
  const skill = skillFile ? parseFrontmatter(readText(skillFile.absolutePath)) : null;
  const packName = (skill?.meta.name ?? path.basename(resolved)).trim();
  const kindValue = skill?.meta.kind;
  const kind: PromptKnowledgePackKind =
    kindValue && PACK_KINDS.has(kindValue) ? (kindValue as PromptKnowledgePackKind) : "skill";

  const fromKnowledge = knowledgeCandidates(files, skipped);
  const indexFile = byRelative.get("index.md");
  const indexSections = indexFile
    ? splitLevelTwoSections(parseFrontmatter(readText(indexFile.absolutePath)).body)
    : [];
  const skillSections = skill ? splitLevelTwoSections(skill.body) : [];

  let candidates: Candidate[];
  if (fromKnowledge.length > 0) {
    candidates = fromKnowledge;
  } else if (indexSections.length >= 2) {
    candidates = sectionsToCandidates(indexSections, "index.md");
  } else if (skillSections.length > 0) {
    candidates = sectionsToCandidates(skillSections, "SKILL.md");
  } else if (skill?.body.trim()) {
    candidates = [{ relativePath: "SKILL.md", title: "overview", content: skill.body.trim() }];
  } else {
    throw new Error("No readable markdown modules found (知识/, index.md or SKILL.md)");
  }

  const previews: Array<Omit<PromptKnowledgeModulePreview, "ord">> = [];
  candidates.forEach((candidate) => {
    const preview = modulePreview(candidate, packName, skipped);
    if (preview) previews.push(preview);
  });

  const { kept, conflicts } = dedupeKnowledgeModules(previews);
  const modules: PromptKnowledgeModulePreview[] = kept.map((entry, index) => ({
    ...entry,
    ord: index,
  }));
  if (modules.length > MAX_KNOWLEDGE_PACK_MODULES) {
    throw new Error(
      `Knowledge pack "${packName}" has ${modules.length} modules; the limit is ${MAX_KNOWLEDGE_PACK_MODULES}`,
    );
  }
  const packConflicts: PromptKnowledgeImportConflict[] = conflicts.map((entry) => ({
    packName,
    moduleKey: entry.moduleKey,
    existingHash: entry.existingHash,
    incomingHash: entry.incomingHash,
    reason: entry.reason,
  }));

  const pack: PromptKnowledgePackPreview = {
    name: packName,
    kind,
    sourcePath: resolved,
    ...(skill?.meta.version ? { version: skill.meta.version } : {}),
    ...(skill?.meta.variant ? { variant: skill.meta.variant } : {}),
    modules,
    skipped,
  };

  const totalBytes = modules.reduce((sum, entry) => sum + entry.bytes, 0);
  const totalTokens = modules.reduce((sum, entry) => sum + entry.tokens, 0);

  return {
    packs: [pack],
    moduleCount: modules.length,
    totalBytes,
    totalTokens,
    skipped,
    conflicts: packConflicts,
  };
}