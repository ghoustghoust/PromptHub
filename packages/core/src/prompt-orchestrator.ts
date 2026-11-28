import { PromptVocabDB } from "@prompthub/db";
import type {
  PromptMossCaptionRefinement,
  PromptMossLayoutDraft,
  PromptMossLayoutReverse,
  PromptModelDirective,
  PromptEntityResolution,
  PromptOrchestrationField,
  PromptOrchestrationInput,
  PromptOrchestrationMode,
  PromptOrchestrationResult,
  PromptRetrievalSummary,
  PromptRoutePlan,
  PromptSelectedTerm,
  PromptTermDecision,
  PromptTokenMetrics,
} from "@prompthub/shared/types";
import {
  isVideoOrchestrationMode,
  supportsReferenceImages,
} from "@prompthub/shared/types";
import {
  applyPromptTaskContract,
  taskContractWarnings,
} from "@prompthub/shared/utils/prompt-task-contract";
import { buildRunEvidence } from "./prompt-run-evidence";
import { buildRunLoad } from "./prompt-run-load";
import { estimatePromptTokens } from "./prompt-token-budget";
import { resolveRequestedShotCount } from "./prompt-stage-contract";
import { inspectStoryboardShape } from "./prompt-storyboard-shape";
import {
  buildCompositionMessages,
  buildFallbackComposition,
  buildFixedFields,
  buildWritingLayerText,
  finalizeMossLayoutComposition,
  mergeFixedFields,
  parsePromptComposition,
  validateTaskComposition,
} from "./prompt-orchestrator-composition";
import type { PromptOrchestratorLlm } from "./prompt-orchestrator-llm";
import {
  selectPromptTerms,
  type PromptVocabularySelection,
} from "./prompt-orchestrator-vocabulary";
import {
  isDynamicPolish,
  runDynamicPolish,
} from "./prompt-orchestrator-dynamic-polish";
import { resolvePromptEntities } from "./prompt-entity-resolution";
import { buildPromptRoutePlan } from "./prompt-input-routing";
import { resolveArtistPipeline, routeArtistTerms } from "./prompt-artist-routing";
import { buildPolicyDecisions, buildProvenance } from "./prompt-provenance";
import {
  runToolRetrieval,
  supportsToolRetrieval,
} from "./prompt-tool-retrieval";
import { buildPromptAlignment } from "./prompt-alignment";
import {
  estimateResultTokenMetrics,
  mossBudgetWarnings,
} from "./prompt-token-budget";
import type { PromptComposition } from "./prompt-orchestrator-composition";
import { mossLayoutValidationError } from "./prompt-moss-layout";
import { MAX_KNOWLEDGE_PACK_MODULES } from "@prompthub/shared/utils/prompt-knowledge";
import {
  MAX_LAYER_CHARS,
  MAX_LAYER_CONTEXT_TOKENS,
  MIN_LAYER_CONTEXT_TOKENS,
  resolveSystemPromptLayerBudget,
} from "./prompt-writing-budget";
import { createStreamCallbacks, type PromptStreamEmitter } from "./prompt-orchestrator-stream";
import {
  refineMossLayoutCaptions,
  reverseMossLayoutFromImages,
} from "./prompt-moss-layout-assist";
import { PromptRetrievalTraceCollector } from "./prompt-retrieval-trace";

const MODES: ReadonlySet<string> = new Set([
  "expand",
  "professional",
  "polish",
  "reverse",
  "edit",
  "random",
  "json",
  "lora",
  "video-text",
  "video-frames",
  "video-multi-reference",
  "video-long",
  "video-short-drama",
  "video-beat",
]);

const ARTIST_PIPELINES: ReadonlySet<string> = new Set([
  "anima",
  "kaloscope",
  "moss",
  "k2",
  "h3",
  "unknown",
]);

export interface PromptOrchestratorOptions {
  vocabulary: PromptVocabDB;
  llm: PromptOrchestratorLlm;
  /** Observational stream side-channel; never changes the final result. */
  onEvent?: PromptStreamEmitter;
  /** Aborts the run; the LLM request and tool rounds observe it. */
  signal?: AbortSignal;
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new PromptOrchestratorError("CANCELLED", "Orchestration was cancelled");
  }
}

interface CompositionRun {
  composition: PromptComposition;
  selectedTerms: PromptSelectedTerm[];
  warnings: string[];
  termDecisions?: PromptTermDecision[];
  retrievalSummary?: PromptRetrievalSummary;
  /** Tool-loop cost: calls made and tokens spent on intermediate turns. */
  usage?: { toolCalls: number; historyTokens: number };
  /** Dynamic-polish planning turn cost. */
  planTokens?: number;
}

export class PromptOrchestratorError extends Error {
  constructor(
    readonly code:
      | "INVALID_INPUT"
      | "MODEL_PROFILE_NOT_FOUND"
      | "SYSTEM_PROMPT_LAYER_OVER_BUDGET"
      | "KNOWLEDGE_SKILL_CONFLICT"
      | "CANCELLED",
    message: string,
  ) {
    super(message);
    this.name = "PromptOrchestratorError";
  }
}

function requireText(value: string | undefined, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new PromptOrchestratorError(
      "INVALID_INPUT",
      `${label} must be a non-empty string`,
    );
  }
  if (value.includes("\0")) {
    throw new PromptOrchestratorError(
      "INVALID_INPUT",
      `${label} contains a null byte`,
    );
  }
  return value.trim();
}

function validateStringArray(
  value: string[] | undefined,
  label: string,
): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    throw new PromptOrchestratorError(
      "INVALID_INPUT",
      `${label} must be an array of strings`,
    );
  }
  value.forEach((entry, index) => requireText(entry, `${label}[${index}]`));
}

const DEFAULT_REVERSE_INSTRUCTION =
  "Describe the supplied image as a ready-to-use generation prompt: state what is visible first, then only clearly supported inferences, and keep the subject unchanged.";

/**
 * Reverse with an image but no text still needs an instruction; otherwise the
 * model receives an empty intent and may stall or answer with nothing.
 */
function applyReverseDefaultPrompt(
  input: PromptOrchestrationInput,
): { input: PromptOrchestrationInput; applied: boolean } {
  if (input.prompt?.trim()) return { input, applied: false };
  if ((input.mode ?? "expand") !== "reverse") return { input, applied: false };
  if ((input.imageUrls?.length ?? 0) === 0) return { input, applied: false };
  return { input: { ...input, prompt: DEFAULT_REVERSE_INSTRUCTION }, applied: true };
}

/**
 * A contract group may be driven by exactly one pack. Two packs that both claim
 * the same group are competing primary skills; merging them silently would let
 * two incompatible structures run at once.
 */
function validatePrimaryKnowledgeSkill(input: PromptOrchestrationInput): void {
  const owners = new Map<string, Map<string, string>>();
  for (const module of input.knowledgeModules ?? []) {
    if (module.role !== "contract") continue;
    const groups = module.contractGroups ?? [];
    if (groups.length === 0) continue;
    const packKey = module.packId ?? module.packName ?? module.id;
    const label = module.packName ?? module.packId ?? module.id;
    for (const group of groups) {
      const packs = owners.get(group) ?? new Map<string, string>();
      packs.set(packKey, label);
      owners.set(group, packs);
    }
  }
  for (const [group, packs] of owners) {
    if (packs.size <= 1) continue;
    throw new PromptOrchestratorError(
      "KNOWLEDGE_SKILL_CONFLICT",
      `Contract group "${group}" is claimed by multiple skills: ${[...packs.values()].join(", ")}. Select one primary skill for this group; skills are never merged automatically.`,
    );
  }
}

function validateInput(input: PromptOrchestrationInput): void {
  validatePrimaryKnowledgeSkill(input);
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new PromptOrchestratorError(
      "INVALID_INPUT",
      "Orchestration input must be an object",
    );
  }
  if (input.mode !== undefined && !MODES.has(input.mode)) {
    throw new PromptOrchestratorError(
      "INVALID_INPUT",
      `Unsupported orchestration mode: ${String(input.mode)}`,
    );
  }
  if (input.targetPipeline !== undefined && !ARTIST_PIPELINES.has(input.targetPipeline)) {
    throw new PromptOrchestratorError(
      "INVALID_INPUT",
      `Unsupported target pipeline: ${String(input.targetPipeline)}`,
    );
  }
  const arrays = [
    ["loraIds", input.loraIds],
    ["categories", input.categories],
    ["selectedTermIds", input.selectedTermIds],
    ["lockedTermIds", input.lockedTermIds],
    ["referenceTermIds", input.referenceTermIds],
    ["excludedTermIds", input.excludedTermIds],
    ["fixedDetails", input.fixedDetails],
    ["constraints", input.constraints],
    ["imageUrls", input.imageUrls],
  ] as const;
  arrays.forEach(([label, value]) => validateStringArray(value, label));
  validateModeRequirements(input);
  validateOptions(input);
}

function validateModeRequirements(input: PromptOrchestrationInput): void {
  const mode = input.mode ?? "expand";
  const hasPrompt = typeof input.prompt === "string" && input.prompt.trim().length > 0;
  const imageCount = input.imageUrls?.length ?? 0;
  const promptOptional =
    mode === "random" ||
    mode === "reverse" ||
    mode === "video-frames" ||
    mode === "video-multi-reference" ||
    mode === "video-long";
  if (!promptOptional && !hasPrompt) requireText(input.prompt, "prompt");
  if (mode === "reverse" && !hasPrompt && imageCount === 0) {
    throw new PromptOrchestratorError(
      "INVALID_INPUT",
      "Reverse mode requires prompt text or at least one reference image",
    );
  }
  if (!supportsReferenceImages(mode) && imageCount > 0) {
    throw new PromptOrchestratorError(
      "INVALID_INPUT",
      "Reference images are not supported by the selected task mode",
    );
  }
  if (mode === "edit") requireText(input.editInstruction, "editInstruction");
  if (mode === "lora" && (input.loraIds?.length ?? 0) === 0) {
    throw new PromptOrchestratorError(
      "INVALID_INPUT",
      "Legacy LoRA mode requires at least one loraIds entry",
    );
  }
  if (mode === "random") {
    requireText(input.random?.subject, "random.subject");
    requireText(input.random?.setting, "random.setting");
  }
  if (mode === "video-frames" && !hasPrompt && imageCount === 0) {
    throw new PromptOrchestratorError(
      "INVALID_INPUT",
      "Frame mode requires transition text or at least one reference image",
    );
  }
  if (
    mode === "video-multi-reference" &&
    imageCount === 0 &&
    !hasPrompt &&
    !input.video?.referencePlan?.trim()
  ) {
    throw new PromptOrchestratorError(
      "INVALID_INPUT",
      "Multi-reference mode requires an image, prompt text, or a textual reference plan",
    );
  }
  if (mode === "video-long" && !hasPrompt && imageCount === 0) {
    throw new PromptOrchestratorError(
      "INVALID_INPUT",
      "Long-video mode requires an image or a starting scene description",
    );
  }
  if (mode === "video-beat") {
    requireText(input.video?.beatTimestamps, "video.beatTimestamps");
  }
  if (isVideoOrchestrationMode(mode) && input.skill !== "minimaxH3") {
    throw new PromptOrchestratorError(
      "INVALID_INPUT",
      "Video task modes require the MiniMax-H3 rule card",
    );
  }
  if (!isVideoOrchestrationMode(mode) && input.skill === "minimaxH3") {
    throw new PromptOrchestratorError(
      "INVALID_INPUT",
      "MiniMax-H3 is only available for video task modes",
    );
  }
}

function validateOutputFormat(input: PromptOrchestrationInput): void {
  const format = input.outputFormat;
  if (
    format !== undefined &&
    !["caption", "tags", "layout", "h3", "agent-system"].includes(format)
  ) {
    throw new PromptOrchestratorError(
      "INVALID_INPUT",
      "Unsupported outputFormat",
    );
  }
  if (input.skill === "moss" && format === undefined) {
    throw new PromptOrchestratorError(
      "INVALID_INPUT",
      "MOSS requires an explicit outputFormat selection",
    );
  }
  if (input.skill === "k2" && format !== undefined && format !== "caption") {
    throw new PromptOrchestratorError(
      "INVALID_INPUT",
      "Krea 2 supports natural-language Caption output only",
    );
  }
  if (format === "tags" && input.skill !== "moss") {
    throw new PromptOrchestratorError(
      "INVALID_INPUT",
      "Tags output is only available for MOSS",
    );
  }
  if (input.skill === "minimaxH3") {
    const expected = input.mode === "video-short-drama" ? "agent-system" : "h3";
    if (format !== expected) {
      throw new PromptOrchestratorError(
        "INVALID_INPUT",
        `MiniMax-H3 requires outputFormat=${expected} for this task`,
      );
    }
  }
  if (input.canvas && format !== "layout") {
    throw new PromptOrchestratorError(
      "INVALID_INPUT",
      "canvas requires outputFormat=layout",
    );
  }
  if (input.canvas) {
    const { width, height } = input.canvas;
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width <= 0 ||
      height <= 0 ||
      width % 16 !== 0 ||
      height % 16 !== 0
    ) {
      throw new PromptOrchestratorError(
        "INVALID_INPUT",
        "Layout canvas dimensions must be positive multiples of 16",
      );
    }
  }
  if (input.layout !== undefined) {
    const layoutError = mossLayoutValidationError(input.layout);
    if (layoutError) {
      throw new PromptOrchestratorError("INVALID_INPUT", layoutError);
    }
    // Both MOSS-family cards describe the same native canvas contract; a draft
    // compiled by PromptHub is valid for either one.
    if (
      (input.skill !== "moss" && input.skill !== "moodyMoss") ||
      format !== "layout"
    ) {
      throw new PromptOrchestratorError(
        "INVALID_INPUT",
        "Native layout drafts require a MOSS-family rule card and outputFormat=layout",
      );
    }
    if (
      input.canvas &&
      (input.canvas.width !== input.layout.canvas.width ||
        input.canvas.height !== input.layout.canvas.height)
    ) {
      throw new PromptOrchestratorError(
        "INVALID_INPUT",
        "canvas and layout.canvas dimensions must match exactly",
      );
    }
  }
}

function validateOptions(input: PromptOrchestrationInput): void {
  if (input.prompt !== undefined) requireText(input.prompt, "prompt");
  if (input.modelId !== undefined) requireText(input.modelId, "modelId");
  if (
    input.systemPromptLayerContextSize !== undefined &&
    (!Number.isInteger(input.systemPromptLayerContextSize) ||
      input.systemPromptLayerContextSize < MIN_LAYER_CONTEXT_TOKENS ||
      input.systemPromptLayerContextSize > MAX_LAYER_CONTEXT_TOKENS)
  ) {
    throw new PromptOrchestratorError(
      "INVALID_INPUT",
      `systemPromptLayerContextSize must be an integer from ${MIN_LAYER_CONTEXT_TOKENS} to ${MAX_LAYER_CONTEXT_TOKENS}`,
    );
  }
  if (
    input.systemPromptLayerOutputReserve !== undefined &&
    (!Number.isInteger(input.systemPromptLayerOutputReserve) ||
      input.systemPromptLayerOutputReserve < 256 ||
      input.systemPromptLayerOutputReserve > 65_536)
  ) {
    throw new PromptOrchestratorError(
      "INVALID_INPUT",
      "systemPromptLayerOutputReserve must be an integer from 256 to 65536",
    );
  }
  if (input.systemPromptLayer !== undefined) {
    const layer = requireText(input.systemPromptLayer, "systemPromptLayer");
    if (layer.length > MAX_LAYER_CHARS) {
      throw new PromptOrchestratorError(
        "INVALID_INPUT",
        `systemPromptLayer must be ${MAX_LAYER_CHARS.toLocaleString("en-US")} characters or fewer`,
      );
    }
  }
  if (input.knowledgeModules !== undefined) {
    if (
      !Array.isArray(input.knowledgeModules) ||
      input.knowledgeModules.length > MAX_KNOWLEDGE_PACK_MODULES
    ) {
      throw new PromptOrchestratorError(
        "INVALID_INPUT",
        `knowledgeModules must be an array of at most ${MAX_KNOWLEDGE_PACK_MODULES} modules`,
      );
    }
    const seenModuleIds = new Set<string>();
    input.knowledgeModules.forEach((module, index) => {
      if (!module || typeof module !== "object") {
        throw new PromptOrchestratorError(
          "INVALID_INPUT",
          `knowledgeModules[${index}] must be an object`,
        );
      }
      const id = requireText(module.id, `knowledgeModules[${index}].id`);
      if (id.length > 500 || seenModuleIds.has(id)) {
        throw new PromptOrchestratorError(
          "INVALID_INPUT",
          `knowledgeModules[${index}].id must be unique and 500 characters or fewer`,
        );
      }
      seenModuleIds.add(id);
      requireText(module.moduleKey, `knowledgeModules[${index}].moduleKey`);
      requireText(module.title, `knowledgeModules[${index}].title`);
      const content = requireText(module.content, `knowledgeModules[${index}].content`);
      if (content.length > MAX_LAYER_CHARS) {
        throw new PromptOrchestratorError(
          "INVALID_INPUT",
          `knowledgeModules[${index}].content must be ${MAX_LAYER_CHARS.toLocaleString("en-US")} characters or fewer`,
        );
      }
      if (
        module.layer !== undefined &&
        module.layer !== "P" &&
        module.layer !== "S" &&
        module.layer !== "H"
      ) {
        throw new PromptOrchestratorError(
          "INVALID_INPUT",
          `knowledgeModules[${index}].layer must be P, S or H`,
        );
      }
    });
  }
  const writingLayerText = buildWritingLayerText(input);
  if (writingLayerText || (input.referenceStyles?.length ?? 0) > 0) {
    if (writingLayerText.length > MAX_LAYER_CHARS) {
      throw new PromptOrchestratorError(
        "INVALID_INPUT",
        `writing layer (systemPromptLayer + knowledgeModules) must be ${MAX_LAYER_CHARS.toLocaleString("en-US")} characters or fewer`,
      );
    }
    const budget = resolveSystemPromptLayerBudget(input, writingLayerText);
    if (!budget.fits) {
      throw new PromptOrchestratorError(
        "SYSTEM_PROMPT_LAYER_OVER_BUDGET",
        `Writing layer (systemPromptLayer + knowledgeModules) needs ${budget.usedTokens} tokens, ` +
          `but only ${budget.budgetTokens} are available in a ${budget.contextTokens}-token context ` +
          `(${budget.overBy} over). Remove modules or sections, use the compressed version, ` +
          "or switch to a larger context preset.",
      );
    }
  }
  if (input.systemPromptLayerSource !== undefined) {
    requireText(input.systemPromptLayerSource, "systemPromptLayerSource");
  }
  if (input.systemPromptLayerPresetId !== undefined) {
    const presetId = requireText(input.systemPromptLayerPresetId, "systemPromptLayerPresetId");
    if (presetId.length > 200) {
      throw new PromptOrchestratorError(
        "INVALID_INPUT",
        "systemPromptLayerPresetId must be 200 characters or fewer",
      );
    }
  }
  if (input.editInstruction !== undefined) {
    requireText(input.editInstruction, "editInstruction");
  }
  if (
    input.skill !== undefined &&
    input.skill !== "moodyMoss" &&
    input.skill !== "moss" &&
    input.skill !== "k2" &&
    input.skill !== "minimaxH3"
  ) {
    throw new PromptOrchestratorError(
      "INVALID_INPUT",
      `Unsupported prompt rule skill: ${String(input.skill)}`,
    );
  }
  if (input.series !== undefined) requireText(input.series, "series");
  if (input.domain !== undefined &&
      !["shared", "anime", "real", "3d"].includes(input.domain)) {
    throw new PromptOrchestratorError(
      "INVALID_INPUT",
      `Unsupported vocabulary domain: ${String(input.domain)}`,
    );
  }
  validateOutputFormat(input);
  const limit = input.candidateLimitPerCategory;
  if (
    limit !== undefined &&
    (!Number.isInteger(limit) || limit < 0 || limit > 12)
  ) {
    throw new PromptOrchestratorError(
      "INVALID_INPUT",
      "candidateLimitPerCategory must be an integer from 0 to 12",
    );
  }
  if (input.includePayload !== undefined && typeof input.includePayload !== "boolean") {
    throw new PromptOrchestratorError(
      "INVALID_INPUT",
      "includePayload must be a boolean",
    );
  }
  if (
    input.guidanceMode !== undefined &&
    input.guidanceMode !== "agent-led" &&
    input.guidanceMode !== "human-led"
  ) {
    throw new PromptOrchestratorError(
      "INVALID_INPUT",
      "guidanceMode must be agent-led or human-led",
    );
  }
  const vocabularyBudget = input.vocabularyTokenBudget;
  if (
    vocabularyBudget !== undefined &&
    (!Number.isInteger(vocabularyBudget) || vocabularyBudget < 0 || vocabularyBudget > 4000)
  ) {
    throw new PromptOrchestratorError(
      "INVALID_INPUT",
      "vocabularyTokenBudget must be an integer from 0 to 4000",
    );
  }
  if (input.video?.durationSeconds !== undefined) {
    const value = input.video.durationSeconds;
    if (!Number.isFinite(value) || value <= 0 || value > 3600) {
      throw new PromptOrchestratorError(
        "INVALID_INPUT",
        "video.durationSeconds must be between 0 and 3600",
      );
    }
  }
  if (input.video?.shotCount !== undefined) {
    const value = input.video.shotCount;
    if (!Number.isInteger(value) || value < 1 || value > 100) {
      throw new PromptOrchestratorError(
        "INVALID_INPUT",
        "video.shotCount must be an integer from 1 to 100",
      );
    }
  }
  for (const key of [
    "style",
    "action",
    "cameraMotion",
    "lighting",
    "audio",
    "music",
    "dialogue",
    "referencePlan",
    "beatTimestamps",
    "continuity",
  ] as const) {
    const value = input.video?.[key];
    if (value !== undefined) requireText(value, `video.${key}`);
  }
  if (input.random?.seed !== undefined) {
    const seedType = typeof input.random.seed;
    if (seedType !== "string" && seedType !== "number") {
      throw new PromptOrchestratorError(
        "INVALID_INPUT",
        "random.seed must be a string or number",
      );
    }
  }
}

function modelDirectives(
  db: PromptVocabDB,
  input: PromptOrchestrationInput,
): PromptModelDirective[] {
  const directives: PromptModelDirective[] = [];
  if (input.modelId) {
    const profile = db.getModelProfile(input.modelId);
    if (profile?.kind === "base") {
      directives.push({
        modelId: profile.id,
        kind: profile.kind,
        triggerWords: profile.triggerWords,
        weightRange: profile.weightRange,
      });
    }
  }
  for (const id of [...new Set(input.loraIds ?? [])]) {
    const profile = db.getModelProfile(id);
    if (!profile || profile.kind !== "lora") {
      throw new PromptOrchestratorError(
        "MODEL_PROFILE_NOT_FOUND",
        `LoRA model profile does not exist: ${id}`,
      );
    }
    directives.push({
      modelId: profile.id,
      kind: profile.kind,
      triggerWords: profile.triggerWords,
      weightRange: profile.weightRange,
    });
  }
  return directives;
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 500 ? `${message.slice(0, 500)}...` : message;
}

/** Resolved character names become fixed facts; artists are routed separately. */
function resolvedIdentityFields(
  entities: PromptEntityResolution[],
): PromptOrchestrationField[] {
  const fields: PromptOrchestrationField[] = [];
  for (const entity of entities) {
    if (entity.status !== "resolved" || !entity.termId || !entity.displayName) continue;
    const category = entity.candidates[0]?.category;
    if (category === "artist") continue;
    fields.push({
      name: category ?? "character",
      value: entity.displayName,
      layer: "fixed",
      source: "user",
      rationale: "Named identity taken verbatim from the input.",
      termId: entity.termId,
    });
  }
  return fields;
}

export class PromptOrchestrator {
  constructor(private readonly options: PromptOrchestratorOptions) {}

  private async tokenMetrics(
    composition: PromptComposition,
    terms: Parameters<typeof estimateResultTokenMetrics>[2],
  ): Promise<PromptTokenMetrics> {
    const estimated = estimateResultTokenMetrics(
      composition.initialPrompt,
      composition.completePrompt,
      terms,
    );
    if (!this.options.llm.countTokens) return estimated;
    try {
      const [initialPromptTokens, completePromptTokens] = await Promise.all([
        this.options.llm.countTokens(composition.initialPrompt),
        this.options.llm.countTokens(composition.completePrompt),
      ]);
      return { ...estimated, initialPromptTokens, completePromptTokens, method: "llm-tokenizer" };
    } catch {
      return estimated;
    }
  }

  private warnings(
    input: PromptOrchestrationInput,
    selectionWarnings: string[],
    metrics: PromptTokenMetrics,
    completePrompt?: string,
  ): string[] {
    const warnings = [...selectionWarnings];
    // A storyboard owes one six-column line per shot; report any drift instead
    // of rewriting the model's text.
    if (input.stage === "storyboard" && completePrompt?.trim()) {
      warnings.push(
        ...inspectStoryboardShape(
          completePrompt,
          resolveRequestedShotCount(input.prompt, input.shotCount),
        ).issues,
      );
    }
    if (input.skill === "moss" && input.outputFormat !== "layout") {
      warnings.push(...mossBudgetWarnings(metrics.completePromptTokens));
    }
    if (input.layout) {
      warnings.push(
        `MOSS Layout was compiled for exactly ${input.layout.canvas.width}x${input.layout.canvas.height}; use the same output dimensions and disable any second prompt-enhancement pass downstream.`,
      );
    }
    if (input.mode === "video-beat") {
      warnings.push(
        "Beat-sync is experimental and is not guaranteed by the official MiniMax-H3 guide; validate cut timing and action accents before production use.",
      );
    }
    if (metrics.method === "estimate") {
      warnings.push(
        "Token counts are deterministic estimates, not official MOSS/MiniMax tokenizer counts.",
      );
    } else {
      warnings.push(
        "Token counts use the connected local LLM tokenizer, not an official MOSS/MiniMax tokenizer.",
      );
    }
    return [...new Set(warnings)];
  }

  private async composePlain(
    input: PromptOrchestrationInput,
    selection: PromptVocabularySelection,
    directives: PromptModelDirective[],
    entities: PromptEntityResolution[],
    routePlan: PromptRoutePlan,
    retrievalTrace: PromptRetrievalTraceCollector,
  ): Promise<CompositionRun> {
    if (isDynamicPolish(input)) {
      const dynamic = await runDynamicPolish({
        input,
        vocabulary: this.options.vocabulary,
        llm: this.options.llm,
        explicitTerms: selection.terms,
        modelDirectives: directives,
        entities,
        routePlan,
        trace: retrievalTrace,
      });
      return { ...dynamic, warnings: [...selection.warnings, ...dynamic.warnings] };
    }
    const messages = buildCompositionMessages(
      input,
      selection.terms,
      directives,
      entities,
    );
    throwIfCancelled(this.options.signal);
    this.options.onEvent?.({ type: "phase", stage: "compose", round: 1 });
    const content = await this.options.llm.complete({
      messages,
      mode: input.mode ?? "expand",
      imageUrls: input.imageUrls,
      ...(this.options.onEvent
        ? { stream: createStreamCallbacks(this.options.onEvent) }
        : {}),
    });
    throwIfCancelled(this.options.signal);
    const composition = parsePromptComposition(
      content,
      input.mode ?? "expand",
      input.includePayload,
    );
    return {
      composition,
      selectedTerms: selection.terms,
      warnings: selection.warnings,
    };
  }

  /**
   * Tool calling is the primary path when the provider supports it; a failing
   * tool loop degrades to the previous deterministic/candidate path instead of
   * losing the whole orchestration.
   */
  private async compose(
    input: PromptOrchestrationInput,
    selection: PromptVocabularySelection,
    directives: PromptModelDirective[],
    entities: PromptEntityResolution[],
    routePlan: PromptRoutePlan,
    retrievalTrace: PromptRetrievalTraceCollector,
  ): Promise<CompositionRun> {
    if (supportsToolRetrieval(input, this.options.llm)) {
      try {
        const tool = await runToolRetrieval({
          input,
          vocabulary: this.options.vocabulary,
          llm: this.options.llm,
          explicitTerms: selection.terms,
          modelDirectives: directives,
          entities,
          routePlan,
          trace: retrievalTrace,
          ...(this.options.onEvent ? { onEvent: this.options.onEvent } : {}),
          ...(this.options.signal ? { signal: this.options.signal } : {}),
        });
        return { ...tool, warnings: [...selection.warnings, ...tool.warnings] };
      } catch (error) {
        // A cancelled run must not silently degrade into a deterministic fallback.
        throwIfCancelled(this.options.signal);
        retrievalTrace.addFallback({
          from: "tool-retrieval",
          to: isDynamicPolish(input) ? "dynamic-polish" : "plain-composition",
          reason: errorMessage(error),
        });
        const fallback = await this.composePlain(
          input,
          selection,
          directives,
          entities,
          routePlan,
          retrievalTrace,
        );
        return {
          ...fallback,
          warnings: [
            ...fallback.warnings,
            `Tool retrieval failed; the former selection path was used instead: ${errorMessage(error)}`,
          ],
        };
      }
    }
    return this.composePlain(input, selection, directives, entities, routePlan, retrievalTrace);
  }

  async orchestrate(
    rawInput: PromptOrchestrationInput,
  ): Promise<PromptOrchestrationResult> {
    // The contract runs first: input this task does not consume is removed
    // before validation, so a stray video/layout payload cannot either reach
    // the model or fail a request the user never intended to make.
    const applied = applyPromptTaskContract(rawInput);
    const startedAt = Date.now();
    const reverseDefault = applyReverseDefaultPrompt(applied.input);
    const input = reverseDefault.input;
    const contract = applied.contract;
    const contractWarnings = [
      ...taskContractWarnings(contract),
      ...(reverseDefault.applied
        ? ["No text prompt was given; Core used a standard reverse instruction."]
        : []),
    ];
    validateInput(input);
    throwIfCancelled(this.options.signal);
    this.options.onEvent?.({ type: "phase", stage: "planning", round: 0 });
    const mode = input.mode ?? "expand";
    const dynamicPolish = isDynamicPolish(input);
    const toolRetrieval = supportsToolRetrieval(input, this.options.llm);
    // Tool calling lets the model choose vocabulary; pre-selecting automatic
    // rows here would hand it answers it did not ask for.
    const selection = selectPromptTerms(
      this.options.vocabulary,
      dynamicPolish || toolRetrieval
        ? { ...input, candidateLimitPerCategory: 0, categories: [] }
        : input,
    );
    const directives = modelDirectives(this.options.vocabulary, input);
    const pipeline = resolveArtistPipeline(input);
    const artistRouting = routeArtistTerms(selection.terms, pipeline);
    const entities = resolvePromptEntities({
      vocabulary: this.options.vocabulary,
      prompt: input.prompt ?? "",
    });
    const routePlan = buildPromptRoutePlan({
      prompt: input.prompt ?? "",
      entities,
      pipeline,
    });
    // Artist rows leave the automatic vocabulary path; only the routed token
    // (Anima/MOSS) may enter the prompt body.
    const compositionTerms = artistRouting.terms;
    const routingWarnings = [
      ...contractWarnings,
      ...selection.warnings,
      ...artistRouting.warnings,
      ...routePlan.warnings,
    ];
    const fixedFields = buildFixedFields(input, compositionTerms, directives);
    const identityFields = resolvedIdentityFields(entities);
const writingLayerText = buildWritingLayerText(input);
  if (input.referenceStyles !== undefined) {
    if (!Array.isArray(input.referenceStyles) || input.referenceStyles.length > 3) {
      throw new PromptOrchestratorError(
        "INVALID_INPUT",
        "referenceStyles must be an array of at most 3 color cards",
      );
    }
    input.referenceStyles.forEach((item, index) => {
      if (!item || typeof item !== "object") {
        throw new PromptOrchestratorError(
          "INVALID_INPUT",
          `referenceStyles[${index}] must be an object`,
        );
      }
      requireText(item.id, `referenceStyles[${index}].id`);
      requireText(item.nameZh, `referenceStyles[${index}].nameZh`);
      requireText(item.category, `referenceStyles[${index}].category`);
      const summary = requireText(item.summary, `referenceStyles[${index}].summary`);
      if (summary.length > 1000) {
        throw new PromptOrchestratorError(
          "INVALID_INPUT",
          `referenceStyles[${index}].summary must be 1000 characters or fewer`,
        );
      }
      if (!Array.isArray(item.palette)) {
        throw new PromptOrchestratorError(
          "INVALID_INPUT",
          `referenceStyles[${index}].palette must be an array`,
        );
      }
    });
  }
    const layerBudget = writingLayerText || (input.referenceStyles?.length ?? 0) > 0
      ? resolveSystemPromptLayerBudget(input, writingLayerText)
      : null;
    const layerMetrics = layerBudget
      ? {
          tokens: layerBudget.usedTokens,
          budgetTokens: layerBudget.budgetTokens,
          contextTokens: layerBudget.contextTokens,
          outputReserveTokens: layerBudget.outputReserveTokens,
          contractTokens: layerBudget.contractTokens,
          safetyTokens: layerBudget.safetyTokens,
          ...(layerBudget.referenceTokens > 0
            ? { referenceTokens: layerBudget.referenceTokens }
            : {}),
          ...(input.systemPromptLayerPresetId
            ? { presetId: input.systemPromptLayerPresetId }
            : {}),
        }
      : null;
    const retrievalTrace = new PromptRetrievalTraceCollector();
    try {
      const completed = await this.compose(
        input,
        { ...selection, terms: compositionTerms },
        directives,
        entities,
        routePlan,
        retrievalTrace,
      );
      validateTaskComposition(input, completed.composition);
      const finalized = finalizeMossLayoutComposition(input, completed.composition);
      const composition = mergeFixedFields(
        finalized,
        [...fixedFields, ...identityFields],
        completed.selectedTerms,
      );
      const tokenMetrics = await this.tokenMetrics(composition, completed.selectedTerms);
      const decisions = completed.termDecisions ?? buildPolicyDecisions({
        terms: completed.selectedTerms,
        fields: composition.fields,
        completePrompt: composition.completePrompt,
        vocabulary: this.options.vocabulary,
        excludedTermIds: input.excludedTermIds,
      });
      const provenance = buildProvenance({
        input,
        vocabulary: this.options.vocabulary,
        terms: completed.selectedTerms,
        decisions,
        entities,
        artistRoutes: artistRouting.routes,
        fields: composition.fields,
        completePrompt: composition.completePrompt,
      });
      const runEvidence = buildRunEvidence({
        input,
        completePrompt: composition.completePrompt,
        fields: composition.fields,
        selectedTerms: completed.selectedTerms,
        decisions,
        directives,
        ...(completed.retrievalSummary
          ? { retrieval: completed.retrievalSummary }
          : {}),
        layoutCompiled: composition.layout !== undefined,
      });
      const load = buildRunLoad({
        input,
        contract,
        completionTokens: tokenMetrics.completePromptTokens,
        ...(completed.retrievalSummary ? { retrieval: completed.retrievalSummary } : {}),
        historyTokens: (completed.usage?.historyTokens ?? 0) + (completed.planTokens ?? 0),
        toolCalls: completed.usage?.toolCalls ?? 0,
        elapsedMs: Date.now() - startedAt,
        vocabularyTokens: estimatePromptTokens(JSON.stringify(completed.selectedTerms)),
      });
      const warnings = this.warnings(
        input,
        [...routingWarnings, ...completed.warnings, ...runEvidence.warnings],
        tokenMetrics,
        composition.completePrompt,
      );
      const pendingCaptions = composition.layout?.pendingCaptions ?? [];
      if (pendingCaptions.length > 0) {
        warnings.push(
          `Layout boxes ${pendingCaptions.map((index) => index + 1).join(", ")} still have no visual description; fill them in or run "补齐逐框描述" before generating.`,
        );
      }
      return {
        mode,
        skill: input.skill ?? "moodyMoss",
        outputFormat: input.outputFormat,
        media: isVideoOrchestrationMode(mode) ? "video" : "image",
        ...composition,
        selectedTerms: completed.selectedTerms,
        modelDirectives: directives,
        warnings,
        tokenMetrics,
        status: "complete",
        guidanceMode: input.guidanceMode ?? "agent-led",
        termDecisions: decisions,
        provenance,
        ...(completed.retrievalSummary
          ? { retrievalSummary: completed.retrievalSummary }
          : {}),
        ...(retrievalTrace.hasContent()
          ? { retrievalTrace: retrievalTrace.snapshot() }
          : {}),
        ...(entities.length > 0 ? { entityResolutions: entities } : {}),
        routePlan,
        ...(artistRouting.routes.length > 0
          ? { artistRoutes: artistRouting.routes }
          : {}),
        alignment: buildPromptAlignment(input.prompt ?? "", composition.completePrompt),
        ...(layerMetrics ? { systemPromptLayerMetrics: layerMetrics } : {}),
        taskContract: contract,
        assembly: runEvidence.assembly,
        evidence: runEvidence.evidence,
        load,
      };
    } catch (error) {
      throwIfCancelled(this.options.signal);
      retrievalTrace.addFallback({
        from: "composition",
        to: "deterministic-fallback",
        reason: errorMessage(error),
      });
      const composition = buildFallbackComposition(
        input,
        compositionTerms,
        directives,
      );
      const tokenMetrics = estimateResultTokenMetrics(
        composition.initialPrompt,
        composition.completePrompt,
        compositionTerms,
      );
      const decisions = buildPolicyDecisions({
        terms: compositionTerms,
        fields: composition.fields,
        completePrompt: composition.completePrompt,
        vocabulary: this.options.vocabulary,
        excludedTermIds: input.excludedTermIds,
      });
      const provenance = buildProvenance({
        input,
        vocabulary: this.options.vocabulary,
        terms: compositionTerms,
        decisions,
        entities,
        artistRoutes: artistRouting.routes,
        fields: composition.fields,
        completePrompt: composition.completePrompt,
      });
      const runEvidence = buildRunEvidence({
        input,
        completePrompt: composition.completePrompt,
        fields: composition.fields,
        selectedTerms: compositionTerms,
        decisions,
        directives,
        layoutCompiled: composition.layout !== undefined,
      });
      return {
        mode,
        skill: input.skill ?? "moodyMoss",
        outputFormat: input.outputFormat,
        media: isVideoOrchestrationMode(mode) ? "video" : "image",
        ...composition,
        ...(mode === "json" || input.includePayload
          ? {
              payload: {
                initialPrompt: composition.initialPrompt,
                completePrompt: composition.completePrompt,
                fields: composition.fields,
              },
            }
          : {}),
        selectedTerms: compositionTerms,
        modelDirectives: directives,
        warnings: [
          ...this.warnings(
            input,
            [...routingWarnings, ...runEvidence.warnings],
            tokenMetrics,
            composition.completePrompt,
          ),
          `LLM composition failed; deterministic fallback used: ${errorMessage(error)}`,
        ],
        tokenMetrics,
        status: "degraded",
        guidanceMode: input.guidanceMode ?? "agent-led",
        termDecisions: decisions,
        provenance,
        ...(retrievalTrace.hasContent()
          ? { retrievalTrace: retrievalTrace.snapshot() }
          : {}),
        ...(entities.length > 0 ? { entityResolutions: entities } : {}),
        routePlan,
        ...(artistRouting.routes.length > 0
          ? { artistRoutes: artistRouting.routes }
          : {}),
        alignment: buildPromptAlignment(
          input.prompt ?? "",
          composition.completePrompt,
        ),
        ...(layerMetrics ? { systemPromptLayerMetrics: layerMetrics } : {}),
        taskContract: contract,
        assembly: runEvidence.assembly,
        evidence: runEvidence.evidence,
        load: buildRunLoad({
          input,
          contract,
          completionTokens: tokenMetrics.completePromptTokens,
          elapsedMs: Date.now() - startedAt,
          toolCalls: 0,
        }),
      };
    }
  }

  /** Fills empty per-box descriptions and polishes the ones the user already wrote. */
  async refineLayoutCaptions(input: {
    draft: PromptMossLayoutDraft;
    intent?: string;
  }): Promise<PromptMossCaptionRefinement> {
    throwIfCancelled(this.options.signal);
    const validationError = mossLayoutValidationError(input.draft);
    if (validationError) throw new Error(validationError);
    const refined = await refineMossLayoutCaptions({
      draft: input.draft,
      intent: input.intent,
      llm: this.options.llm,
    });
    // The helper degrades to warnings on failure; a cancelled run must surface
    // as CANCELLED instead of a partial "not refined" result.
    throwIfCancelled(this.options.signal);
    return refined;
  }

  /** Reverses a poster or graphic into editable normalized layout boxes. */
  async reverseLayoutFromImage(input: {
    images: string[];
    canvas: PromptMossLayoutDraft["canvas"];
    intent?: string;
  }): Promise<PromptMossLayoutReverse> {
    throwIfCancelled(this.options.signal);
    if (
      !Number.isInteger(input.canvas.width) ||
      !Number.isInteger(input.canvas.height) ||
      input.canvas.width <= 0 ||
      input.canvas.height <= 0
    ) {
      throw new Error("Layout canvas dimensions must be positive integers");
    }
    const reversed = await reverseMossLayoutFromImages({
      images: input.images,
      canvas: input.canvas,
      intent: input.intent,
      llm: this.options.llm,
    });
    throwIfCancelled(this.options.signal);
    return reversed;
  }
}
