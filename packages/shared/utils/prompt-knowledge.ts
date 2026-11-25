import type {
  PromptKnowledgeConflictReason,
  PromptKnowledgeModuleLayer,
} from "../types/prompt-knowledge";
import { estimatePromptTokens } from "@prompthub/shared/utils/prompt-token-estimate";

/** Upper bounds from the A6 knowledge-pack contract. */
export const MAX_KNOWLEDGE_PACK_MODULES = 200;
export const MAX_KNOWLEDGE_MODULE_BYTES = 50 * 1024;
export const MAX_KNOWLEDGE_MODULE_TOKENS = 6000;

const SKIP_DIRECTORIES = ["agents/", "tools/"];
/** Original source copies sit next to the inject-ready module; skip them. */
const SOURCE_DIRECTORIES = ["源/", "source/"];
const BACKUP_MARKERS = ["_备份", ".bak"];

/**
 * Returns a human-readable reason when a source path must not be imported,
 * or null when the file is eligible.
 */
export function isSkippedKnowledgePath(sourcePath: string): string | null {
  const normalized = sourcePath.replace(/\\/g, "/").toLowerCase();
  if (BACKUP_MARKERS.some((marker) => normalized.includes(marker.toLowerCase()))) {
    return "backup or variant copy is skipped by default";
  }
  for (const directory of SOURCE_DIRECTORIES) {
    if (normalized.includes(`/${directory}`) || normalized.startsWith(directory)) {
      return "source copy is skipped; the inject version is imported";
    }
  }
  for (const directory of SKIP_DIRECTORIES) {
    if (normalized.includes(`/${directory}`) || normalized.startsWith(directory)) {
      return `${directory.replace("/", "")} sources are never imported automatically`;
    }
  }
  return null;
}

/**
 * Maps a section heading to the writing layer. Definition/rules/thresholds/
 * boundaries are principles; timecode, axis, shot, transition and sound cues
 * are structure; everything else is handoff material.
 */
export function resolveKnowledgeLayer(heading: string): PromptKnowledgeModuleLayer {
  const text = heading.trim().toLowerCase();
  // Structure cues are checked first: "轴线规则" must not match the general
  // principle keyword "规则".
  const structure = [
    "时间码",
    "轴线",
    "shot",
    "镜头",
    "转场",
    "音效",
    "timeline",
    "transition",
    "sound",
  ];
  if (structure.some((keyword) => text.includes(keyword))) return "S";
  const principle = [
    "definition",
    "rules",
    "quantified thresholds",
    "boundaries",
    "定义",
    "规则",
    "阈值",
    "边界",
  ];
  if (principle.some((keyword) => text.includes(keyword))) return "P";
  return "H";
}

/** Returns the reason a module exceeds the per-module limits, or null. */
export function knowledgeModuleSizeError(content: string): string | null {
  const bytes = new TextEncoder().encode(content).byteLength;
  if (bytes > MAX_KNOWLEDGE_MODULE_BYTES) {
    return `module is ${bytes} bytes; the limit is ${MAX_KNOWLEDGE_MODULE_BYTES} (50KB)`;
  }
  const tokens = estimatePromptTokens(content);
  if (tokens > MAX_KNOWLEDGE_MODULE_TOKENS) {
    return `module is ~${tokens} tokens; the limit is ${MAX_KNOWLEDGE_MODULE_TOKENS}`;
  }
  return null;
}

/**
 * Drops repeated content and reports key collisions. The first occurrence
 * wins, matching an import preview that shows what will actually be written.
 */
export function dedupeKnowledgeModules<T extends { moduleKey: string; contentHash: string }>(
  modules: T[],
): {
  kept: T[];
  conflicts: Array<{
    moduleKey: string;
    existingHash: string;
    incomingHash: string;
    reason: PromptKnowledgeConflictReason;
  }>;
} {
  const kept: T[] = [];
  const conflicts: Array<{
    moduleKey: string;
    existingHash: string;
    incomingHash: string;
    reason: PromptKnowledgeConflictReason;
  }> = [];
  const seenHashes = new Set<string>();
  const seenKeys = new Set<string>();

  for (const entry of modules) {
    if (seenHashes.has(entry.contentHash)) {
      conflicts.push({
        moduleKey: entry.moduleKey,
        existingHash: entry.contentHash,
        incomingHash: entry.contentHash,
        reason: "duplicate-content",
      });
      continue;
    }
    if (seenKeys.has(entry.moduleKey)) {
      conflicts.push({
        moduleKey: entry.moduleKey,
        existingHash: "",
        incomingHash: entry.contentHash,
        reason: "module-key",
      });
      continue;
    }
    seenHashes.add(entry.contentHash);
    seenKeys.add(entry.moduleKey);
    kept.push(entry);
  }
  return { kept, conflicts };
}
