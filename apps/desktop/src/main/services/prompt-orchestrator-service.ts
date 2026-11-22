import {
  OpenAiCompatiblePromptLlm,
  PromptOrchestrator,
  PromptSkillGenerator,
  coreAIConfigService,
  type CoreAIModelConfig,
} from "@prompthub/core";
import { PromptFeedbackDB, PromptVocabDB } from "@prompthub/db";
import type Database from "@prompthub/db/adapter";
import type {
  DesktopPromptFeedbackRequest,
  DesktopPromptOrchestrationRequest,
  DesktopPromptSkillGenerationRequest,
  PromptMossCaptionRefinement,
  PromptMossLayoutDraft,
  PromptMossLayoutReverse,
  PromptOrchestrationInput,
  PromptOrchestrationResult,
  PromptResultFeedbackInput,
  PromptResultFeedbackRecord,
  PromptSkillDraft,
  PromptVocabularyBrowseInput,
  PromptVocabularyBrowseResult,
  PromptVocabularySearchInput,
  PromptVocabularySearchItem,
} from "@prompthub/shared/types";

const MAX_REVERSE_IMAGES = 4;
const MAX_IMAGE_CHARS = 16_000_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isChatModel(model: CoreAIModelConfig): boolean {
  return model.type === "chat" && model.capabilities?.chat !== false;
}

export class PromptOrchestratorConfigError extends Error {
  constructor(
    readonly code: "LLM_NOT_CONFIGURED" | "LLM_PROTOCOL_UNSUPPORTED",
    message: string,
  ) {
    super(message);
    this.name = "PromptOrchestratorConfigError";
  }
}

function parseRequest(value: unknown): DesktopPromptOrchestrationRequest {
  if (!isRecord(value) || !isRecord(value.input)) {
    throw new Error("Orchestrator IPC input must contain an input object");
  }
  const llmModelId = value.llmModelId;
  if (
    llmModelId !== undefined &&
    (typeof llmModelId !== "string" || !llmModelId.trim())
  ) {
    throw new Error("llmModelId must be a non-empty string");
  }
  return {
    // Core performs the full input validation after this IPC shape check.
    input: value.input as PromptOrchestrationInput,
    ...(typeof llmModelId === "string" ? { llmModelId } : {}),
  };
}

function parseSkillRequest(
  value: unknown,
): DesktopPromptSkillGenerationRequest {
  const request = parseRequest(value);
  if (!isRecord(value)) throw new Error("Skill generation input must be an object");
  const skillName = value.skillName;
  if (
    skillName !== undefined &&
    (typeof skillName !== "string" || !skillName.trim())
  ) {
    throw new Error("skillName must be a non-empty string");
  }
  return {
    ...request,
    ...(typeof skillName === "string" ? { skillName } : {}),
  };
}

function optionalModelId(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function selectModel(
  models: CoreAIModelConfig[],
  requestedId: string | undefined,
  routedId: string | undefined,
): CoreAIModelConfig {
  const chatModels = models.filter(isChatModel);
  const model = requestedId
    ? chatModels.find((candidate) => candidate.id === requestedId)
    : chatModels.find((candidate) => candidate.id === routedId) ??
      chatModels.find((candidate) => candidate.isDefault) ??
      chatModels[0];
  if (!model) {
    throw new PromptOrchestratorConfigError(
      "LLM_NOT_CONFIGURED",
      requestedId
        ? `Configured chat model was not found: ${requestedId}`
        : "Configure an OpenAI-compatible chat model before using the orchestrator",
    );
  }
  if (model.apiProtocol !== "openai") {
    throw new PromptOrchestratorConfigError(
      "LLM_PROTOCOL_UNSUPPORTED",
      "Prompt orchestration currently requires an OpenAI-compatible chat model",
    );
  }
  return model;
}

function parseFeedbackRequest(value: unknown): DesktopPromptFeedbackRequest {
  if (
    !isRecord(value) ||
    !isRecord(value.input) ||
    !isRecord(value.result) ||
    !isRecord(value.feedback)
  ) {
    throw new Error("Feedback input must contain input, result and feedback objects");
  }
  const rating = value.feedback.rating;
  if (rating !== "usable" && rating !== "unusable") {
    throw new Error("Feedback rating must be usable or unusable");
  }
  const reasons = value.feedback.reasons;
  if (reasons !== undefined && !Array.isArray(reasons)) {
    throw new Error("Feedback reasons must be an array");
  }
  const note = value.feedback.note;
  if (note !== undefined && typeof note !== "string") {
    throw new Error("Feedback note must be a string");
  }
  const status = value.result.status;
  if (status !== "complete" && status !== "degraded") {
    throw new Error("Feedback result status must be complete or degraded");
  }
  if (typeof value.result.completePrompt !== "string" || !value.result.completePrompt.trim()) {
    throw new Error("Feedback requires a non-empty result prompt");
  }
  const feedback: PromptResultFeedbackInput = {
    rating,
    reasons: (reasons ?? []) as PromptResultFeedbackInput["reasons"],
    ...(typeof note === "string" ? { note } : {}),
  };
  return {
    input: value.input as PromptOrchestrationInput,
    // Structured-clone results cross IPC as unknown; required fields were
    // checked above, and the feedback writer only reads known properties.
    result: value.result as unknown as PromptOrchestrationResult,
    feedback,
  };
}

export class DesktopPromptOrchestratorService {
  private readonly vocabulary: PromptVocabDB;
  private readonly feedback: PromptFeedbackDB;

  constructor(db: Database.Database) {
    this.vocabulary = new PromptVocabDB(db);
    this.feedback = new PromptFeedbackDB(db);
  }

  listSeries(): string[] {
    return this.vocabulary.listSeries();
  }

  searchTerms(value: unknown): PromptVocabularySearchItem[] {
    if (!isRecord(value)) throw new Error("Vocabulary search input must be an object");
    return this.vocabulary.searchTerms(value as PromptVocabularySearchInput);
  }

  browseTerms(value: unknown): PromptVocabularyBrowseResult {
    if (!isRecord(value)) throw new Error("Vocabulary browse input must be an object");
    return this.vocabulary.browseTerms(value as PromptVocabularyBrowseInput);
  }

  resolveTerms(value: unknown): PromptVocabularySearchItem[] {
    if (!isRecord(value) || !Array.isArray(value.terms)) {
      throw new Error("Vocabulary resolve input must contain a terms array");
    }
    const terms = value.terms;
    if (terms.length < 1 || terms.length > 500) {
      throw new Error("Vocabulary resolve accepts 1 to 500 terms");
    }
    for (const term of terms) {
      if (typeof term !== "string" || !term.trim()) {
        throw new Error("Vocabulary resolve terms must be non-empty strings");
      }
      if (term.includes("\0")) {
        throw new Error("Vocabulary resolve terms must not contain null bytes");
      }
    }
    return this.vocabulary.resolveTerms(terms as string[]);
  }

  async run(value: unknown): Promise<PromptOrchestrationResult> {
    const request = parseRequest(value);
    const orchestrator = new PromptOrchestrator({
      vocabulary: this.vocabulary,
      llm: this.createLlm(request.llmModelId),
    });
    return orchestrator.orchestrate(request.input);
  }

  /**
 * Stores one result-level feedback row. The snapshot deliberately excludes
 * reference images and layout payloads: feedback is about the result, and those
 * fields are large and reproducible from the request.
 */
  submitFeedback(value: unknown): PromptResultFeedbackRecord {
    const request = parseFeedbackRequest(value);
    const { input, result, feedback } = request;
    const promptText =
      [input.prompt, input.random?.subject, input.random?.setting]
        .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
        .join(" / ")
        .slice(0, 4000) || "untitled result";
    return this.feedback.add({
      mode: result.mode,
      skill: result.skill,
      outputFormat: result.outputFormat ?? null,
      guidanceMode: input.guidanceMode ?? result.guidanceMode ?? null,
      status: result.status,
      rating: feedback.rating,
      reasons: feedback.reasons,
      note: feedback.note ?? null,
      promptExcerpt: promptText,
      resultExcerpt: result.completePrompt.slice(0, 4000),
      snapshot: {
        mode: result.mode,
        skill: result.skill,
        outputFormat: result.outputFormat ?? null,
        guidanceMode: input.guidanceMode ?? result.guidanceMode ?? null,
        modelId: input.modelId ?? null,
        prompt: promptText,
        completePrompt: result.completePrompt,
        termDecisions: result.termDecisions ?? [],
        provenance: result.provenance ?? [],
        retrievalSummary: result.retrievalSummary ?? null,
        entityResolutions: result.entityResolutions ?? [],
        artistRoutes: result.artistRoutes ?? [],
        warnings: result.warnings,
        tokenMetrics: result.tokenMetrics,
      },
    });
  }

  async generateSkill(value: unknown): Promise<PromptSkillDraft> {
    const request = parseSkillRequest(value);
    const generator = new PromptSkillGenerator({
      vocabulary: this.vocabulary,
      llm: this.createLlm(request.llmModelId),
    });
    return generator.generate(request.input, request.skillName);
  }

  async refineLayoutCaptions(value: unknown): Promise<PromptMossCaptionRefinement> {
    if (!isRecord(value) || !isRecord(value.draft)) {
      throw new Error("Layout caption input must contain a draft object");
    }
    const orchestrator = new PromptOrchestrator({
      vocabulary: this.vocabulary,
      llm: this.createLlm(optionalModelId(value.llmModelId)),
    });
    return orchestrator.refineLayoutCaptions({
      draft: value.draft as unknown as PromptMossLayoutDraft,
      ...(typeof value.intent === "string" ? { intent: value.intent } : {}),
    });
  }

  async reverseLayout(value: unknown): Promise<PromptMossLayoutReverse> {
    if (!isRecord(value) || !isRecord(value.canvas)) {
      throw new Error("Layout reverse input must contain a canvas");
    }
    const width = value.canvas.width;
    const height = value.canvas.height;
    if (
      typeof width !== "number" ||
      typeof height !== "number" ||
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width <= 0 ||
      height <= 0
    ) {
      throw new Error("Layout reverse canvas must use positive integer width and height");
    }
    if (!Array.isArray(value.images)) {
      throw new Error("Layout reverse images must be an array");
    }
    const images = value.images.filter(
      (image): image is string => typeof image === "string" && image.length > 0,
    );
    if (images.length === 0) {
      throw new Error("Select at least one reference image to reverse");
    }
    if (images.length > MAX_REVERSE_IMAGES) {
      throw new Error(`Layout reverse accepts at most ${MAX_REVERSE_IMAGES} images`);
    }
    if (images.some((image) => image.length > MAX_IMAGE_CHARS)) {
      throw new Error("Reference image is too large to reverse");
    }
    const orchestrator = new PromptOrchestrator({
      vocabulary: this.vocabulary,
      llm: this.createLlm(optionalModelId(value.llmModelId)),
    });
    return orchestrator.reverseLayoutFromImage({
      images,
      canvas: { width, height },
      ...(typeof value.intent === "string" ? { intent: value.intent } : {}),
    });
  }

  private createLlm(llmModelId?: string): OpenAiCompatiblePromptLlm {
    const config = coreAIConfigService.read();
    const model = selectModel(
      config.models,
      llmModelId,
      config.modelRouteDefaults.mainText ?? config.modelRouteDefaults.fastText,
    );
    return new OpenAiCompatiblePromptLlm({
      endpoint: model.apiUrl,
      model: model.model,
      apiKey: model.apiKey,
    });
  }
}
