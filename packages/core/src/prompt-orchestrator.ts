import { PromptVocabDB } from "@prompthub/db";
import type {
  PromptModelDirective,
  PromptOrchestrationInput,
  PromptOrchestrationMode,
  PromptOrchestrationResult,
  PromptTokenMetrics,
} from "@prompthub/shared/types";
import {
  isVideoOrchestrationMode,
  supportsReferenceImages,
} from "@prompthub/shared/types";
import {
  buildCompositionMessages,
  buildFallbackComposition,
  buildFixedFields,
  mergeFixedFields,
  parsePromptComposition,
  validateTaskComposition,
} from "./prompt-orchestrator-composition";
import type { PromptOrchestratorLlm } from "./prompt-orchestrator-llm";
import { selectPromptTerms } from "./prompt-orchestrator-vocabulary";
import { buildPromptAlignment } from "./prompt-alignment";
import {
  estimateResultTokenMetrics,
  mossBudgetWarnings,
} from "./prompt-token-budget";
import type { PromptComposition } from "./prompt-orchestrator-composition";

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

export interface PromptOrchestratorOptions {
  vocabulary: PromptVocabDB;
  llm: PromptOrchestratorLlm;
}

export class PromptOrchestratorError extends Error {
  constructor(
    readonly code: "INVALID_INPUT" | "MODEL_PROFILE_NOT_FOUND",
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

function validateInput(input: PromptOrchestrationInput): void {
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
  const arrays = [
    ["loraIds", input.loraIds],
    ["categories", input.categories],
    ["selectedTermIds", input.selectedTermIds],
    ["lockedTermIds", input.lockedTermIds],
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
}

function validateOptions(input: PromptOrchestrationInput): void {
  if (input.prompt !== undefined) requireText(input.prompt, "prompt");
  if (input.modelId !== undefined) requireText(input.modelId, "modelId");
  if (input.systemPromptLayer !== undefined) {
    const layer = requireText(input.systemPromptLayer, "systemPromptLayer");
    if (layer.length > 4000) {
      throw new PromptOrchestratorError(
        "INVALID_INPUT",
        "systemPromptLayer must be 4000 characters or fewer",
      );
    }
  }
  if (input.systemPromptLayerSource !== undefined) {
    requireText(input.systemPromptLayerSource, "systemPromptLayerSource");
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
  ): string[] {
    const warnings = [...selectionWarnings];
    if (input.skill === "moss" && input.outputFormat !== "layout") {
      warnings.push(...mossBudgetWarnings(metrics.completePromptTokens));
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

  async orchestrate(
    input: PromptOrchestrationInput,
  ): Promise<PromptOrchestrationResult> {
    validateInput(input);
    const mode = input.mode ?? "expand";
    const selection = selectPromptTerms(this.options.vocabulary, input);
    const directives = modelDirectives(this.options.vocabulary, input);
    const fixedFields = buildFixedFields(input, selection.terms, directives);
    const messages = buildCompositionMessages(input, selection.terms, directives);
    try {
      const content = await this.options.llm.complete({
        messages,
        mode,
        imageUrls: input.imageUrls,
      });
      const parsed = parsePromptComposition(content, mode, input.includePayload);
      validateTaskComposition(input, parsed);
      const composition = mergeFixedFields(
        parsed,
        fixedFields,
        selection.terms,
      );
      const tokenMetrics = await this.tokenMetrics(composition, selection.terms);
      return {
        mode,
        skill: input.skill ?? "moodyMoss",
        outputFormat: input.outputFormat,
        media: isVideoOrchestrationMode(mode) ? "video" : "image",
        ...composition,
        selectedTerms: selection.terms,
        modelDirectives: directives,
        warnings: this.warnings(input, selection.warnings, tokenMetrics),
        tokenMetrics,
        status: "complete",
        alignment: buildPromptAlignment(input.prompt ?? "", composition.completePrompt),
      };
    } catch (error) {
      const composition = buildFallbackComposition(
        input,
        selection.terms,
        directives,
      );
      const tokenMetrics = estimateResultTokenMetrics(
        composition.initialPrompt,
        composition.completePrompt,
        selection.terms,
      );
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
        selectedTerms: selection.terms,
        modelDirectives: directives,
        warnings: [
          ...this.warnings(input, selection.warnings, tokenMetrics),
          `LLM composition failed; deterministic fallback used: ${errorMessage(error)}`,
        ],
        tokenMetrics,
        status: "degraded",
        alignment: buildPromptAlignment(
          input.prompt ?? "",
          composition.completePrompt,
        ),
      };
    }
  }
}
