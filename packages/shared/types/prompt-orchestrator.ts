import type {
  PromptModelProfileKind,
  PromptTermDomain,
  PromptTermValidationStatus,
} from "./prompt-vocab";
import type {
  PromptMossLayoutDraft,
  PromptMossLayoutResult,
} from "./prompt-moss-layout";
import type { PromptKnowledgeContractGroup, PromptKnowledgeModuleLayer } from "./prompt-knowledge";

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

/** Where an artist name can actually take effect. */
export type PromptArtistPipeline =
  | "anima"
  | "kaloscope"
  | "moss"
  | "k2"
  | "h3"
  | "unknown";

export type PromptEntitySignal =
  | "at-prefix"
  | "series-qualified"
  | "quoted"
  | "cjk"
  | "alias";

export type PromptEntityStatus = "resolved" | "ambiguous" | "unresolved";

/**
 * One recognized identity. Multiple stored rows (a name-only row and a
 * name+appearance bundle) collapse into one identity; the bundle is never used
 * as the identity value.
 */
export interface PromptEntityCandidate {
  identityKey: string;
  displayName: string;
  category: string;
  subcategory: string | null;
  series: string | null;
  zh: string | null;
  termIds: string[];
  /** True when a stored row appends an appearance list after the name. */
  hasAppearanceBundle: boolean;
  validationStatus: PromptTermValidationStatus;
}

export interface PromptEntityMention {
  text: string;
  /** Character offsets into the original prompt. */
  start: number;
  end: number;
  /** How the mention was recognized; `alias` means a plain dictionary hit. */
  signal: PromptEntitySignal;
}

/**
 * Exact/alias identity lookup for one mention. `ambiguous` carries candidates
 * instead of a guess; `unresolved` keeps the user's text verbatim.
 */
export interface PromptEntityResolution {
  mention: PromptEntityMention;
  status: PromptEntityStatus;
  /** Preferred stored row; absent when ambiguous or unresolved. */
  termId?: string;
  displayName?: string;
  candidates: PromptEntityCandidate[];
  reason: string;
}

export type PromptRouteSegmentKind =
  | "named-entity"
  | "trigger"
  | "constrained"
  | "atomic-tag"
  | "prose";

export interface PromptRouteSegment {
  kind: PromptRouteSegmentKind;
  text: string;
  /** Identity, trigger and parameter text must survive verbatim. */
  verbatim: boolean;
  allowCreate: boolean;
  negated: boolean;
  relation: boolean;
}

/** Which retrieval path the input needs, and what the model may not invent. */
export interface PromptRoutePlan {
  path: "lexical" | "entity-only" | "hybrid";
  segments: PromptRouteSegment[];
  allowCreate: boolean;
  /** Categories automatic retrieval must never query for this input. */
  forbiddenCategories: string[];
  warnings: string[];
}

export interface PromptArtistInjection {
  artistName: string;
  bank: string;
  styleGuidance: number;
  adapterStrength: number;
  baseModel: string;
}

export interface PromptArtistRoute {
  pipeline: PromptArtistPipeline;
  termId: string;
  artistName: string;
  /** Token written into the prompt body; null means it must stay out of text. */
  promptToken: string | null;
  injection: PromptArtistInjection | null;
  reason: string;
}

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
  /**
   * Target pipeline for artist routing. Anima consumes `@artist`; Kaloscope
   * takes the artist as node parameters; MOSS/Krea2 do not parse `@`.
   * Omitted derives from `skill` and falls back to `unknown`.
   */
  targetPipeline?: PromptArtistPipeline;
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
  /** Optional material: the model may reuse, adapt or ignore these terms. */
  referenceTermIds?: string[];
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
  /** Title of the saved prompt or preset the layer came from, for provenance display. */
  systemPromptLayerSource?: string;
  /** Writing preset id; recorded for provenance, never used to authorize content. */
  systemPromptLayerPresetId?: string;
  /**
   * Context window the layer must fit in. Local runs use the engine setting;
   * cloud runs must declare it explicitly instead of assuming a model window.
   */
  systemPromptLayerContextSize?: number;
  /** Output tokens reserved so the layer cannot eat the answer budget. */
  systemPromptLayerOutputReserve?: number;
  /**
   * Imported knowledge modules appended to the writing layer. They share the
   * same token budget as `systemPromptLayer` and are never executed.
   */
  knowledgeModules?: PromptKnowledgeModuleSelection[];
  /**
   * Content range for the rule card. Absent or false keeps the all-ages
   * default; true allows the explicit adult branch of the skill contract.
   * It permits a branch, it never forces one.
   */
  allowAdult?: boolean;
  /** Director color cards (reference layer), at most three per run. */
  referenceStyles?: PromptReferenceStyleInput[];
  /** Adds a structured payload without turning JSON into a separate authoring task. */
  includePayload?: boolean;
  /** Estimated automatic-vocabulary budget; explicit user selections are retained. */
  vocabularyTokenBudget?: number;
  video?: PromptVideoOrchestrationInput;
}

/**
 * One imported knowledge module selected for this run. Only the text is used;
 * module ids are recorded in provenance so the result panel can show sources.
 */
export interface PromptKnowledgeModuleSelection {
  id: string;
  packId?: string;
  packName?: string;
  moduleKey: string;
  title: string;
  layer?: PromptKnowledgeModuleLayer;
  /** Estimated tokens from the import preview; the orchestrator re-checks. */
  tokens?: number;
  content: string;
}

/**
 * One selected director color card. Reference styles are injected as a compact
 * visual-direction block, never as P/S/H writing-layer modules.
 */
export interface PromptReferenceStyleInput {
  id: string;
  nameZh: string;
  nameEn?: string;
  category: string;
  summary: string;
  palette: string[];
  style?: {
    lighting?: string;
    framing?: string;
    grading?: string;
    avoid?: string[];
  };
}

export type PromptTermSelectionReason = "explicit" | "relevance" | "random" | "reference";

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

export type PromptTermDecisionStrategy = "reuse" | "adapt" | "create" | "ignore";

export interface PromptTermDecisionTerm {
  id: string;
  category: string;
  en: string;
  zh: string | null;
}

/** Auditable knowledge-use decision for one semantic slot in a polished prompt. */
export interface PromptTermDecision {
  slotId: string;
  category: string;
  sourceText: string;
  strategy: PromptTermDecisionStrategy;
  terms: PromptTermDecisionTerm[];
  /** Empty only for ignore; create intentionally has no vocabulary terms. */
  output: string;
  rationale: string;
  /**
   * `model` means the LLM chose the strategy; `policy` means Core derived it
   * from explicit selections and field usage in modes without model decisions.
   */
  origin?: "model" | "policy";
}

export interface PromptRetrievalSummary {
  rounds: number;
  queryCount: number;
  candidateCount: number;
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
  /** Stream events are tagged with this id; generated by the renderer per run. */
  runId?: string;
}

export type PromptOrchestratorStreamStage = "planning" | "retrieval" | "compose";

export type PromptOrchestratorStreamEvent =
  | {
      type: "phase";
      stage: PromptOrchestratorStreamStage;
      round: number;
      detail?: string;
    }
  | { type: "delta"; text: string }
  | { type: "structure"; fields: string[]; percent: number }
  | {
      type: "stats";
      mode: "stream" | "buffered";
      firstTokenMs?: number;
      completionTokens?: number;
      tokensPerSecond?: number;
      source: "provider" | "estimate";
    };

export interface PromptOrchestratorStreamEnvelope {
  runId: string;
  event: PromptOrchestratorStreamEvent;
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
  /** Cancellation id, matching prompt:orchestrator:cancel. */
  runId?: string;
}

export interface DesktopPromptLayoutReverseRequest {
  images: string[];
  canvas: { width: number; height: number };
  intent?: string;
  llmModelId?: string;
  runId?: string;
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

export type PromptDecisionOrigin = "user" | "model" | "policy";

export type PromptProvenanceState =
  | "locked"
  | "recommended"
  | "reference"
  | "excluded"
  | "auto"
  | "random"
  | "resolved"
  | "ambiguous"
  | "unresolved";

export type PromptProvenanceOutcome =
  | "fixed"
  | "verbatim"
  | "adapted"
  | "absent"
  | "injected";

/**
 * One row of the cross-mode decision trail: every vocabulary term, resolved
 * identity, artist route and user constraint gets a state and an outcome, no
 * matter which mode produced the result.
 */
export interface PromptProvenanceEntry {
  /** Stable key: term id, `entity:<mention>`, `artist:<termId>` or `field:<name>`. */
  id: string;
  kind: "term" | "entity" | "artist" | "constraint" | "module" | "reference";
  label: string;
  state: PromptProvenanceState;
  outcome: PromptProvenanceOutcome;
  /** What actually entered the prompt; empty when absent or injected. */
  excerpt: string;
  origin: PromptDecisionOrigin;
  termId?: string;
  slotId?: string;
  strategy?: PromptTermDecisionStrategy;
  reason?: string;
}

export type PromptPickerTermState = "locked" | "recommended" | "reference" | "excluded";

/**
 * Picker rows persisted with the workspace. Only fields needed to render and
 * re-run the selection are stored; vocabulary content remains owned by
 * prompt_terms.
 */
export interface PromptOrchestratorWorkspaceTerm {
  id: string;
  category: string;
  subcategory: string | null;
  en: string;
  zh: string | null;
  series: string | null;
  template: string | null;
  validationStatus: PromptTermValidationStatus;
  state: PromptPickerTermState;
}

/** Durable selection and archive for the orchestrator workbench. */
export interface PromptOrchestratorWorkspaceState {
  prefabTerms: PromptOrchestratorWorkspaceTerm[];
  modelId: string;
  loraIds: string;
  /** Assembled writing layer text, persisted so a manual edit survives reload. */
  systemLayerText?: string;
  systemLayerSource?: string | null;
  writingPresetId?: string | null;
  writingPresetVariant?: PromptWritingLayerVariant;
  writingPresetSectionIds?: string[];
  /** Canvas draft (size and boxes) so a reload keeps the current layout. */
  mossLayout?: PromptMossLayoutDraft;
  /** Imported knowledge packs shown in the writing-layer picker. */
  knowledgePackIds?: string[];
  /** Selected knowledge modules appended to the writing layer. */
  knowledgeModuleIds?: string[];
  /** Project type used to pick one contract group (script/storyboard/novel). */
  knowledgeContractGroup?: PromptKnowledgeContractGroup;
  /** Selected director color cards; at most three per run. */
  referenceItemIds?: string[];
  /** Content range switch; absent or false keeps the all-ages default. */
  allowAdult?: boolean;
  updatedAt?: string;
}

export type PromptWritingLayerVariant = "compressed" | "original";

export type PromptResultRating = "usable" | "unusable";

export type PromptResultFeedbackReason =
  | "intent-drift"
  | "subject-wrong"
  | "too-generic"
  | "too-specific"
  | "conflicting"
  | "style-off"
  | "format-broken"
  | "other";

export interface PromptResultFeedbackInput {
  rating: PromptResultRating;
  reasons: PromptResultFeedbackReason[];
  note?: string;
}

/** Stored result-level feedback; never upgrades term validation by itself. */
export interface PromptResultFeedbackRecord {
  id: string;
  createdAt: string;
  mode: string;
  skill: string;
  outputFormat: string | null;
  guidanceMode: string | null;
  status: "complete" | "degraded";
  rating: PromptResultRating;
  reasons: PromptResultFeedbackReason[];
  note: string | null;
  promptExcerpt: string;
  resultExcerpt: string;
}

export interface CreatePromptResultFeedbackDTO {
  mode: string;
  skill: string;
  outputFormat?: string | null;
  guidanceMode?: string | null;
  status: "complete" | "degraded";
  rating: PromptResultRating;
  reasons?: PromptResultFeedbackReason[];
  note?: string | null;
  promptExcerpt: string;
  resultExcerpt: string;
  /** Full result snapshot for later analysis; never contains credentials. */
  snapshot: unknown;
}

export interface DesktopPromptFeedbackRequest {
  input: PromptOrchestrationInput;
  result: PromptOrchestrationResult;
  feedback: PromptResultFeedbackInput;
}

export interface PromptWritingLayerBudgetPreview {
  contextTokens: number;
  outputReserveTokens: number;
  contractTokens: number;
  inputTokens: number;
  vocabularyTokens: number;
  imageTokens: number;
  safetyTokens: number;
  /** Reference color-card tokens reserved separately from the writing layer. */
  referenceTokens: number;
  /** Tokens left for the writing layer in this configuration. */
  budgetTokens: number;
}

export interface DesktopPromptWritingBudgetRequest {
  skill?: PromptOrchestrationSkill;
  mode?: PromptOrchestrationMode;
  outputFormat?: PromptOrchestrationOutputFormat;
  vocabularyTokenBudget?: number;
  imageCount?: number;
  contextTokens?: number;
  outputReserveTokens?: number;
  /** Reference tokens the UI already selected; the preview reserves them. */
  referenceTokens?: number;
  /** Content range of the rule card the preview must price. */
  allowAdult?: boolean;
}

export interface PromptSystemPromptLayerMetrics {
  /** Estimated tokens of the injected writing layer (not the model tokenizer). */
  tokens: number;
  /** Tokens available for the layer under the declared context and reserve. */
  budgetTokens: number;
  contextTokens: number;
  outputReserveTokens: number;
  /** Static rule card and contract tokens counted against the same context. */
  contractTokens: number;
  safetyTokens: number;
  referenceTokens?: number;
  presetId?: string;
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
  /** Guidance mode that produced this result, for result-level feedback. */
  guidanceMode?: PromptGuidanceMode;
  /** Additional directly consumable payload returned in JSON mode. */
  payload?: unknown;
  /** Sentence-level pairing between the user's input and the final prompt. */
  alignment?: PromptAlignment;
  /** Present when the native MOSS layout canvas produced the final JSON. */
  layout?: PromptMossLayoutResult;
  /** Present for the dynamic polish prototype; ignored candidates remain auditable. */
  termDecisions?: PromptTermDecision[];
  retrievalSummary?: PromptRetrievalSummary;
  /** Named identities recognized in the input, including ambiguous candidates. */
  entityResolutions?: PromptEntityResolution[];
  /** Deterministic input classification used to choose the retrieval path. */
  routePlan?: PromptRoutePlan;
  /** Artist names split out of the prompt body according to the target pipeline. */
  artistRoutes?: PromptArtistRoute[];
  /** Cross-mode decision trail for terms, identities, artists and constraints. */
  provenance?: PromptProvenanceEntry[];
  /** Present when a writing layer was injected, with the budget it had to fit. */
  systemPromptLayerMetrics?: PromptSystemPromptLayerMetrics;
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
