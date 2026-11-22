import type {
  PromptArtistPipeline,
  PromptEntityResolution,
  PromptRoutePlan,
  PromptRouteSegment,
  PromptRouteSegmentKind,
} from "@prompthub/shared/types";
import { normalizeEntityKey } from "@prompthub/shared/utils/prompt-entity-key";

const TRIGGER_SYNTAX = /<lora:[^>\n]{1,120}>/i;
/** Parameters that must survive verbatim and never be replaced by vocabulary. */
const CONSTRAINED_SYNTAX = [
  /@[A-Za-z0-9][A-Za-z0-9'’._-]*/,
  /\([^()\n]{1,80}:\s*-?\d+(?:\.\d+)?\)/,
  /\b\d{2,3}\s?mm\b/i,
  /\bf\/\d+(?:\.\d+)?/i,
  /\b1\/\d{2,4}\s?s\b/i,
  /\b\d{1,2}:\d{1,2}\b/,
  /\b\d{3,5}\s?[x×]\s?\d{3,5}\b/i,
];
const NEGATION_SYNTAX =
  /(不要|避免|没有|不使用|除去|除[^，。]{0,12}外|\bno\b|\bnot\b|\bwithout\b|\bavoid\b|\bexclude\b)/i;
const RELATION_SYNTAX =
  /(抱着|牵着|靠着|依偎|坐在|躺在|站在|看向|握着|背后|身后|左边|右边|旁边|\bholding\b|\bcarrying\b|\bleaning\b|\bsitting\b|\blying\b|\bstanding\b|\bbeside\b|\bbehind\b|\bleft of\b|\bright of\b|\bfacing\b)/i;

const SEGMENT_SEPARATOR = /[,，;；\n。.!！?？]+/;
const PROSE_HINTS =
  /\b(?:a|an|the|is|are|was|were|has|have|with|by|in|on|at|while|from|into|through|standing|sitting|walking|reading|holding|looking|wearing)\b/i;
const FORBIDDEN_CATEGORIES = ["artist", "character", "nsfw"] as const;

function isAtomicTag(text: string): boolean {
  const compact = text.trim();
  if (!compact || compact.length > 32) return false;
  if (PROSE_HINTS.test(compact)) return false;
  const words = compact.split(/\s+/).filter(Boolean);
  return words.length <= 4;
}

/** Deterministic classification of one comma/sentence piece. */
export function classifyPromptSegment(
  text: string,
  entityKeys: ReadonlySet<string>,
): PromptRouteSegment {
  const value = text.trim();
  const negated = NEGATION_SYNTAX.test(value);
  const relation = RELATION_SYNTAX.test(value);
  let kind: PromptRouteSegmentKind = "prose";
  if (TRIGGER_SYNTAX.test(value)) kind = "trigger";
  else if (entityKeys.has(normalizeEntityKey(value))) kind = "named-entity";
  else if (CONSTRAINED_SYNTAX.some((pattern) => pattern.test(value))) kind = "constrained";
  else if (isAtomicTag(value)) kind = "atomic-tag";
  return {
    kind,
    text: value,
    verbatim: kind === "trigger" || kind === "constrained" || kind === "named-entity",
    allowCreate: (kind === "prose" || kind === "atomic-tag") && !negated,
    negated,
    relation,
  };
}

export interface BuildPromptRoutePlanOptions {
  prompt: string;
  entities: PromptEntityResolution[];
  pipeline: PromptArtistPipeline;
}

/**
 * Decides which retrieval path the input needs. Named identities, triggers and
 * fixed parameters never depend on vocabulary; only the remaining descriptive
 * text goes through the existing lexical retriever.
 */
export function buildPromptRoutePlan(
  options: BuildPromptRoutePlanOptions,
): PromptRoutePlan {
  const entityKeys = new Set(
    options.entities.map((entity) => normalizeEntityKey(entity.mention.text)),
  );
  const segments = options.prompt
    .split(SEGMENT_SEPARATOR)
    .map((piece) => piece.trim())
    .filter(Boolean)
    .map((piece) => classifyPromptSegment(piece, entityKeys));
  const descriptive = segments.filter(
    (segment) => segment.kind === "prose" || segment.kind === "atomic-tag",
  );
  const path =
    descriptive.length === 0
      ? "entity-only"
      : options.entities.length > 0
        ? "hybrid"
        : "lexical";
  const warnings: string[] = [];
  for (const entity of options.entities) {
    if (entity.status === "ambiguous") {
      warnings.push(
        `Entity "${entity.mention.text}" is ambiguous; candidates were returned instead of a guess.`,
      );
    } else if (
      entity.status === "unresolved" &&
      (entity.mention.signal === "at-prefix" ||
        entity.mention.signal === "quoted" ||
        entity.mention.signal === "series-qualified")
    ) {
      warnings.push(
        `Explicit entity mention "${entity.mention.text}" is not in the vocabulary; it was kept verbatim.`,
      );
    }
  }
  if (options.pipeline === "unknown" && options.prompt.includes("@")) {
    warnings.push(
      "Artist mentions were detected but the target pipeline is unknown; set targetPipeline before relying on artist routing.",
    );
  }
  return {
    path,
    segments,
    allowCreate: segments.some((segment) => segment.allowCreate),
    forbiddenCategories: [...FORBIDDEN_CATEGORIES],
    warnings,
  };
}
