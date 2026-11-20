import type {
  PromptModelProfileKind,
  PromptTermDomain,
  PromptTermValidationStatus,
} from "./prompt-vocab";
import type {
  PromptMossLayoutDraft,
  PromptMossLayoutResult,
} from "./prompt-moss-layout";

export type PromptOrchestrationMode =
  | "expand"
  | "professional"
  | "polish"
  | "reverse"
  | "edit"
  | "random"
  | "json"
  | "lora"
  | "video-text"
  | "video-frames"
  | "video-multi-reference"
  | "video-long"
  | "video-short-drama"
  | "video-beat";

export type PromptCreativityLayer = "fixed" | "flexible" | "optional";
export type PromptOrchestrationSkill =
  | "moodyMoss"
  | "moss"
  | "k2"
  | "minimaxH3";
export type PromptOrchestrationOutputFormat =
  | "caption"
  | "tags"
  | "layout"
  | "h3"
  | "agent-system";
export type PromptGuidanceMode = "agent-led" | "human-led";

export interface PromptOrchestrationCanvas {
  width: number;
  height: number;
}

export interface PromptRandomConstraints {
  subject: string;
  setting: string;
  seed?: string | number;
}

export interface PromptVideoOrchestrationInput {
  durationSeconds?: number;
  shotCount?: number;
  style?: string;
  action?: string;
  cameraMotion?: string;
  lighting?: string;
  audio?: string;
  music?: string;
  dialogue?: string;
  referencePlan?: string;
  beatTimestamps?: string;
  continuity?: string;
}

export interface PromptOrchestrationInput {
  /** User intent, source prompt, or textual reference for reverse mode. */
  prompt?: string;
  mode?: PromptOrchestrationMode;
  /** Image model id used for applicable_models filtering. */
  modelId?: string;
  /** Optional series filter; generic terms remain eligible. */
  series?: string;
  /** Specific subject domain also includes shared descriptors. */
  domain?: PromptTermDomain;
  outputFormat?: PromptOrchestrationOutputFormat;
  canvas?: PromptOrchestrationCanvas;
  /** Native editable MOSS layout; normalized boxes are compiled deterministically. */
  layout?: PromptMossLayoutDraft;
  loraIds?: string[];
  categories?: string[];
  selectedTermIds?: string[];
  lockedTermIds?: string[];
  excludedTermIds?: string[];
  fixedDetails?: string[];
  constraints?: string[];
  editInstruction?: string;
  random?: PromptRandomConstraints;
  /** HTTP(S) image URLs or data:image URLs, used by reverse mode. */
  imageUrls?: string[];
  candidateLimitPerCategory?: number;
  validatedOnly?: boolean;
  skill?: PromptOrchestrationSkill;
  /** Human-led keeps explicit vocabulary selections central and disables automatic additions by default. */
  guidanceMode?: PromptGuidanceMode;
  /**
   * Extra system-layer instruction applied on top of the rule card, such as a
   * house style, camera language, or required action beats. It steers the
   * composition and is never copied verbatim into the final prompt.
   */
  systemPromptLayer?: string;
  /** Title of the saved prompt the layer came from, for provenance display. */
  systemPromptLayerSource?: string;
  /** Adds a structured payload without turning JSON into a separate authoring task. */
  includePayload?: boolean;
  /** Estimated automatic-vocabulary budget; explicit user selections are retained. */
  vocabularyTokenBudget?: number;
  video?: PromptVideoOrchestrationInput;
}

export type PromptTermSelectionReason = "explicit" | "relevance" | "random";

export interface PromptSelectedTerm {
  id: string;
  category: string;
  en: string;
  zh: string | null;
  series: string | null;
  template: string | null;
  source: string | null;
  validationStatus: PromptTermValidationStatus;
  locked: boolean;
  selectionReason: PromptTermSelectionReason;
}

export interface PromptModelDirective {
  modelId: string;
  kind: PromptModelProfileKind;
  triggerWords: string[];
  weightRange: string | null;
}

export type PromptFieldSource =
  | "user"
  | "vocabulary"
  | "model-profile"
  | "llm";

export interface PromptOrchestrationField {
  name: string;
  value: string;
  layer: PromptCreativityLayer;
  source: PromptFieldSource;
  rationale?: string;
  termId?: string;
}

export interface DesktopPromptOrchestrationRequest {
  input: PromptOrchestrationInput;
  /** Existing PromptHub chat model config id; omitted uses mainText/default. */
  llmModelId?: string;
}

export type PromptOrchestratorIPCReply<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

export interface DesktopPromptSkillGenerationRequest
  extends DesktopPromptOrchestrationRequest {
  /** Optional slug; the generator normalizes model-derived names when omitted. */
  skillName?: string;
}

export interface DesktopPromptLayoutCaptionRequest {
  draft: PromptMossLayoutDraft;
  /** Overall scene intent used to fill empty per-box descriptions. */
  intent?: string;
  /** Existing PromptHub chat model config id; omitted uses mainText/default. */
  llmModelId?: string;
}

export interface DesktopPromptLayoutReverseRequest {
  images: string[];
  canvas: { width: number; height: number };
  intent?: string;
  llmModelId?: string;
}

export type PromptSkillReferenceKind =
  | "rule-card"
  | "vocabulary"
  | "model-profile";

export interface PromptSkillReferenceItem {
  kind: PromptSkillReferenceKind;
  id: string;
  label: string;
  content: string;
  validationStatus?: PromptTermValidationStatus;
}

export interface PromptSkillSuggestion {
  title: string;
  content: string;
  rationale?: string;
}

export interface PromptSkillDraft {
  name: string;
  description: string;
  ruleCard: PromptOrchestrationSkill;
  content: string;
  references: PromptSkillReferenceItem[];
  suggestions: PromptSkillSuggestion[];
  warnings: string[];
  status: "complete" | "degraded";
}

export interface PromptTokenMetrics {
  initialPromptTokens: number;
  completePromptTokens: number;
  vocabularyEstimatedTokens: number;
  method: "llm-tokenizer" | "estimate";
}

export interface PromptVocabularySearchItem {
  id: string;
  category: string;
  subcategory: string | null;
  en: string;
  zh: string | null;
  series: string | null;
  template: string | null;
  /** Subject domain; omitted rows are treated as shared by older callers. */
  domain?: PromptTermDomain;
  validationStatus: PromptTermValidationStatus;
}

export interface PromptVocabularySearchInput {
  query?: string;
  category?: string;
  series?: string;
  /** Specific domain also matches `shared` terms; omit to search every domain. */
  domain?: PromptTermDomain;
  limit?: number;
}

export interface PromptVocabularyBrowseInput extends PromptVocabularySearchInput {
  /** Empty string selects rows without a subcategory; omitted keeps every subcategory. */
  subcategory?: string;
  offset?: number;
  translation?: "all" | "missing" | "translated";
}

export interface PromptVocabularyCategoryCount {
  category: string;
  count: number;
}

export interface PromptVocabularySubcategoryCount {
  subcategory: string | null;
  count: number;
}

/** Database-backed page with exact counts, never a truncated 5000-row estimate. */
export interface PromptVocabularyBrowseResult {
  items: PromptVocabularySearchItem[];
  total: number;
  offset: number;
  limit: number;
  categories: PromptVocabularyCategoryCount[];
  subcategories: PromptVocabularySubcategoryCount[];
  /** Rows with no Chinese value under the current filters, before subcategory selection. */
  missingTranslation: number;
}

/**
 * Exact lookup used by curated collections (style packs and preset combos).
 * Matching ignores case, underscores, escaped parentheses and extra spacing so
 * one reference resolves against whichever spelling the imported library uses.
 */
export interface PromptVocabularyResolveInput {
  terms: string[];
}

export interface PromptAlignmentSegment {
  id: string;
  text: string;
}

/**
 * One visual row of a side-by-side comparison. A row either pairs a source
 * sentence with a generated sentence, marks a generated sentence as new, or
 * shows a source sentence that produced no counterpart.
 */
export interface PromptAlignmentRow {
  id: string;
  /** Linked source sentence; null for sentences the assistant added. */
  leftId: string | null;
  /** Linked generated sentence; null for unmatched source sentences. */
  rightId: string | null;
  /** True when the generated sentence has no counterpart in the source text. */
  isNew: boolean;
}

export interface PromptAlignment {
  leftSegments: PromptAlignmentSegment[];
  rightSegments: PromptAlignmentSegment[];
  rows: PromptAlignmentRow[];
  /** "none" means one side was empty and no pairing could be computed. */
  method: "sentence-match" | "none";
}

export interface PromptOrchestrationResult {
  mode: PromptOrchestrationMode;
  skill: PromptOrchestrationSkill;
  outputFormat?: PromptOrchestrationOutputFormat;
  media: "image" | "video";
  initialPrompt: string;
  completePrompt: string;
  fields: PromptOrchestrationField[];
  selectedTerms: PromptSelectedTerm[];
  modelDirectives: PromptModelDirective[];
  warnings: string[];
  tokenMetrics: PromptTokenMetrics;
  /** Degraded means the deterministic fallback was used after an LLM failure. */
  status: "complete" | "degraded";
  /** Additional directly consumable payload returned in JSON mode. */
  payload?: unknown;
  /** Sentence-level pairing between the user's input and the final prompt. */
  alignment?: PromptAlignment;
  /** Present when the native MOSS layout canvas produced the final JSON. */
  layout?: PromptMossLayoutResult;
}

export function isVideoOrchestrationMode(
  mode: PromptOrchestrationMode | undefined,
): boolean {
  return mode?.startsWith("video-") === true;
}

export function supportsReferenceImages(
  mode: PromptOrchestrationMode | undefined,
): boolean {
  return (
    mode === "reverse" ||
    mode === "video-frames" ||
    mode === "video-multi-reference" ||
    mode === "video-long"
  );
}
