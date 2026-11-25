import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type {
  PromptKnowledgeImportCommitResult,
  PromptKnowledgeImportConflict,
  PromptKnowledgeImportPreview,
  PromptKnowledgeImportSkipped,
  PromptKnowledgeModule,
  PromptKnowledgeModuleLayer,
  PromptKnowledgeModulePreview,
  PromptKnowledgeModuleRole,
  PromptKnowledgePack,
  PromptKnowledgePackKind,
  PromptKnowledgePackPreview,
} from "@prompthub/shared/types";
import type { PromptKnowledgeDB } from "@prompthub/db";
import {
  dedupeKnowledgeModules,
  isSkippedKnowledgePath,
  knowledgeModuleSizeError,
  MAX_KNOWLEDGE_PACK_MODULES,
  resolveKnowledgeLayer,
  resolveKnowledgeContractGroups,
  resolveKnowledgeModuleRole,
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
  role?: PromptKnowledgeModuleRole;
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
    role: resolveKnowledgeModuleRole(section.title),
    ...(category ? { category } : {}),
  }));
}

/**
 * A pack without SKILL.md/index.md/知识 is a plain document bundle (for example
 * a performance-method knowledge base). Each level-2 section becomes a module
 * so no single document has to exceed the per-module limit.
 */
function documentCandidates(
  files: { relativePath: string; absolutePath: string }[],
): Candidate[] {
  const candidates: Candidate[] = [];
  for (const file of files) {
    if (file.relativePath.includes("/")) continue;
    if (file.relativePath === "SKILL.md" || file.relativePath === "index.md") continue;
    const body = parseFrontmatter(readText(file.absolutePath)).body.trim();
    if (!body) continue;
    const base = path.basename(file.relativePath, path.extname(file.relativePath));
    const sections = splitLevelTwoSections(body);
    if (sections.length === 0) {
      candidates.push({
        relativePath: file.relativePath,
        title: base,
        content: body,
        category: base,
        role: resolveKnowledgeModuleRole(base),
      });
      continue;
    }
    for (const section of sections) {
      candidates.push({
        relativePath: file.relativePath,
        title: `${base} · ${section.title}`,
        content: section.content,
        category: base,
        layerHint: section.title,
        role: resolveKnowledgeModuleRole(section.title),
      });
    }
  }
  return candidates;
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
      role: resolveKnowledgeModuleRole(title, parsed.meta.role),
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
  const role = candidate.role ?? resolveKnowledgeModuleRole(candidate.title);
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
    role,
    contractGroups: resolveKnowledgeContractGroups(candidate.title, role),
    layer,
    triggers: candidate.triggers ?? [],
    dependsOn: candidate.dependsOn ?? [],
    tokens: estimatePromptTokens(candidate.content),
    bytes: new TextEncoder().encode(candidate.content).byteLength,
    contentHash: hashText(candidate.content),
  };
}

interface ScannedModule {
  preview: PromptKnowledgeModulePreview;
  content: string;
}

interface ScannedPack {
  preview: PromptKnowledgePackPreview;
  sourceHash: string;
  modules: ScannedModule[];
  conflicts: PromptKnowledgeImportConflict[];
}

/**
 * Scans one pack directory and keeps module bodies in main memory only. The
 * IPC preview drops them; commit re-scans and verifies the hashes instead of
 * trusting renderer-supplied content.
 */
function scanKnowledgePack(rootPath: string): ScannedPack {
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
    kindValue && PACK_KINDS.has(kindValue)
      ? (kindValue as PromptKnowledgePackKind)
      : skillFile ? "skill" : "knowledge";

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
    candidates = [{
      relativePath: "SKILL.md",
      title: "overview",
      content: skill.body.trim(),
      role: "contract",
    }];
  } else {
    const documents = documentCandidates(files);
    if (documents.length === 0) {
      throw new Error("No readable markdown modules found (知识/, index.md, SKILL.md or root documents)");
    }
    candidates = documents;
  }

  const contentByKey = new Map<string, string>();
  const previews: Array<Omit<PromptKnowledgeModulePreview, "ord">> = [];
  candidates.forEach((candidate) => {
    const preview = modulePreview(candidate, packName, skipped);
    if (!preview) return;
    previews.push(preview);
    contentByKey.set(preview.moduleKey, candidate.content);
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

  const scannedModules: ScannedModule[] = modules.map((preview) => ({
    preview,
    content: contentByKey.get(preview.moduleKey) ?? "",
  }));
  const sourceHash = hashText(
    skillFile
      ? readText(skillFile.absolutePath)
      : scannedModules.map((entry) => entry.preview.contentHash).join("\n"),
  );

  return { preview: pack, sourceHash, modules: scannedModules, conflicts: packConflicts };
}

/** Scans one pack directory and returns what an import would write. */
export function previewKnowledgePack(rootPath: string): PromptKnowledgeImportPreview {
  const scanned = scanKnowledgePack(rootPath);
  const modules = scanned.preview.modules;
  return {
    packs: [scanned.preview],
    moduleCount: modules.length,
    totalBytes: modules.reduce((sum, entry) => sum + entry.bytes, 0),
    totalTokens: modules.reduce((sum, entry) => sum + entry.tokens, 0),
    skipped: scanned.preview.skipped,
    conflicts: scanned.conflicts,
  };
}

export interface KnowledgeCommitOptions {
  /** Optional display name override for the imported pack. */
  packName?: string;
  /** Import only these module keys; defaults to the whole preview. */
  moduleKeys?: string[];
}

function moduleRole(value: unknown): PromptKnowledgeModuleRole {
  if (value === "contract" || value === "knowledge" || value === "reference") return value;
  throw new Error(`Unsupported knowledge module role: ${String(value)}`);
}

function sameKeys(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const sorted = [...right].sort();
  return [...left].sort().every((key, index) => key === sorted[index]);
}

/**
 * Writes a preview into the knowledge tables. Re-scans the source so the
 * renderer cannot inject content, verifies every selected hash, and replaces
 * a previous import rooted at the same path.
 */
export function commitKnowledgeImport(
  knowledge: PromptKnowledgeDB,
  preview: PromptKnowledgeImportPreview,
  options: KnowledgeCommitOptions = {},
): PromptKnowledgeImportCommitResult {
  const packIds: string[] = [];
  let moduleCount = 0;
  const skipped: PromptKnowledgeImportSkipped[] = [];
  const conflicts: PromptKnowledgeImportConflict[] = [];
  const now = Date.now();

  for (const packPreview of preview.packs) {
    const scanned = scanKnowledgePack(packPreview.sourcePath);
    const previewKeys = packPreview.modules.map((entry) => entry.moduleKey);
    if (!sameKeys(previewKeys, scanned.modules.map((entry) => entry.preview.moduleKey))) {
      throw new Error(
        `Knowledge pack "${packPreview.name}" changed since preview; preview it again`,
      );
    }
    const byKey = new Map(scanned.modules.map((entry) => [entry.preview.moduleKey, entry]));
    const selectedKeys = options.moduleKeys ?? previewKeys;
    for (const key of selectedKeys) {
      const previewModule = packPreview.modules.find((entry) => entry.moduleKey === key);
      const scannedModule = byKey.get(key);
      if (!previewModule || !scannedModule) {
        throw new Error(`Module "${key}" is not part of this preview`);
      }
      if (previewModule.contentHash !== scannedModule.preview.contentHash) {
        throw new Error(
          `Knowledge pack "${packPreview.name}" changed since preview; preview it again`,
        );
      }
    }

    const packId = crypto.randomUUID();
    const name = options.packName?.trim() || packPreview.name;
    const pack: PromptKnowledgePack = {
      id: packId,
      name,
      kind: packPreview.kind,
      sourcePath: packPreview.sourcePath,
      sourceHash: scanned.sourceHash,
      ...(packPreview.version ? { version: packPreview.version } : {}),
      ...(packPreview.variant ? { variant: packPreview.variant } : {}),
      status: "ready",
      createdAt: now,
      updatedAt: now,
    };
    const modules: PromptKnowledgeModule[] = selectedKeys.map((key, ord) => {
      const scannedModule = byKey.get(key)!;
      const entry = scannedModule.preview;
      const requested = packPreview.modules.find((module) => module.moduleKey === key)!;
      const role = moduleRole(requested.role);
      return {
        id: crypto.randomUUID(),
        packId,
        moduleKey: entry.moduleKey,
        title: entry.title,
        ...(entry.category ? { category: entry.category } : {}),
        ...(entry.scope ? { scope: entry.scope } : {}),
        ...(entry.priority ? { priority: entry.priority } : {}),
        role,
        contractGroups: resolveKnowledgeContractGroups(entry.title, role),
        layer: entry.layer,
        triggers: entry.triggers,
        dependsOn: entry.dependsOn,
        content: scannedModule.content,
        contentHash: entry.contentHash,
        tokens: entry.tokens,
        ord,
      };
    });

    knowledge.replacePack(pack, modules);
    packIds.push(packId);
    moduleCount += modules.length;
    skipped.push(...packPreview.skipped);
    conflicts.push(...preview.conflicts);
  }

  return { packIds, moduleCount, skipped, conflicts };
}