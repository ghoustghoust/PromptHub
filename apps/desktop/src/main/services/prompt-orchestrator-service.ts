import {
  OpenAiCompatiblePromptLlm,
  PromptOrchestrator,
  PromptSkillGenerator,
  coreAIConfigService,
  resolveSystemPromptLayerBudget,
  type CoreAIModelConfig,
} from "@prompthub/core";
import { PromptFeedbackDB, PromptOrchestratorStateDB, PromptVocabDB } from "@prompthub/db";
import type Database from "@prompthub/db/adapter";
import type {
  DesktopPromptFeedbackRequest,
  DesktopPromptOrchestrationRequest,
  DesktopPromptSkillGenerationRequest,
  PromptMossCaptionRefinement,
  PromptMossLayoutDraft,
  PromptMossLayoutReverse,
  PromptMossNormalizedBBox,
  PromptOrchestrationInput,
  PromptOrchestrationResult,
  PromptOrchestratorWorkspaceState,
  PromptOrchestratorWorkspaceTerm,
  PromptResultFeedbackInput,
  PromptResultFeedbackRecord,
  PromptSkillDraft,
  PromptVocabularyBrowseInput,
  PromptVocabularyBrowseResult,
  PromptVocabularySearchInput,
  PromptVocabularySearchItem,
  PromptWritingLayerBudgetPreview,
  PromptOrchestratorStreamEvent,
} from "@prompthub/shared/types";
import {
  MAX_LAYOUT_BOXES,
  MAX_LAYOUT_CANVAS_SIDE,
  MAX_LAYOUT_ID_CHARS,
  MAX_LAYOUT_TEXT_CHARS,
  MAX_WRITING_LAYER_CHARS,
} from "@prompthub/shared/utils/prompt-orchestrator-limits";

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

function optionalInteger(
  value: unknown,
  min: number,
  max: number,
  label: string,
): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`${label} must be an integer from ${min} to ${max}`);
  }
  return value as number;
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

const PICKER_STATES: ReadonlySet<string> = new Set([
  "locked",
  "recommended",
  "reference",
  "excluded",
]);
const TERM_VALIDATION_STATES: ReadonlySet<string> = new Set([
  "pending",
  "unvalidated",
  "validated",
  "deprecated",
]);
const MAX_WORKSPACE_TERMS = 2000;

function workspaceText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  const text = value.trim();
  if (text.length > maxLength || text.includes("\0")) {
    throw new Error(`${label} exceeds its length limit or contains a null byte`);
  }
  return text;
}

function optionalWorkspaceText(
  value: unknown,
  label: string,
  maxLength: number,
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new Error(`${label} must be a string or null`);
  const text = value.trim();
  if (!text) return null;
  if (text.length > maxLength || text.includes("\0")) {
    throw new Error(`${label} exceeds its length limit (${maxLength}) or contains a null byte`);
  }
  return text;
}

/** Canvas captions and exact text are persisted verbatim; only length is checked. */
function exactWorkspaceText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  if (value.length > maxLength || value.includes("\0")) {
    throw new Error(`${label} exceeds its length limit (${maxLength}) or contains a null byte`);
  }
  return value;
}

function workspaceCanvasSide(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value <= 0 ||
    value > MAX_LAYOUT_CANVAS_SIDE
  ) {
    throw new Error(`mossLayout canvas sides must be integers from 1 to ${MAX_LAYOUT_CANVAS_SIDE}`);
  }
  return value;
}

function workspaceBBox(value: unknown, label: string): PromptMossNormalizedBBox {
  if (!Array.isArray(value) || value.length !== 4) {
    throw new Error(`${label} must be four integers from 0 to 1000`);
  }
  const coordinates: number[] = [];
  for (const entry of value) {
    if (typeof entry !== "number" || !Number.isInteger(entry) || entry < 0 || entry > 1000) {
      throw new Error(`${label} must be four integers from 0 to 1000`);
    }
    coordinates.push(entry);
  }
  const [top, left, bottom, right] = coordinates;
  if (top >= bottom || left >= right) {
    throw new Error(`${label} must keep top < bottom and left < right`);
  }
  return [top, left, bottom, right];
}

function readWorkspaceLayout(value: unknown): PromptMossLayoutDraft {
  if (!isRecord(value) || value.version !== 1) {
    throw new Error("mossLayout.version must be 1");
  }
  if (!isRecord(value.canvas)) throw new Error("mossLayout.canvas is required");
  const width = workspaceCanvasSide(value.canvas.width);
  const height = workspaceCanvasSide(value.canvas.height);
  if (!Array.isArray(value.boxes) || value.boxes.length > MAX_LAYOUT_BOXES) {
    throw new Error(`mossLayout.boxes must be an array of at most ${MAX_LAYOUT_BOXES} boxes`);
  }
  const seen = new Set<string>();
  const boxes = value.boxes.map((entry, index) => {
    const label = `mossLayout.boxes[${index}]`;
    if (!isRecord(entry)) throw new Error(`${label} must be an object`);
    const id = workspaceText(entry.id, `${label}.id`, MAX_LAYOUT_ID_CHARS);
    if (seen.has(id)) throw new Error(`${label}.id must be unique`);
    seen.add(id);
    const rawLabel = entry.label;
    if (rawLabel !== "object" && rawLabel !== "text") {
      throw new Error(`${label}.label must be object or text`);
    }
    const boxLabel: "object" | "text" = rawLabel === "text" ? "text" : "object";
    const caption = exactWorkspaceText(entry.caption, `${label}.caption`, MAX_LAYOUT_TEXT_CHARS);
    const text = entry.text === undefined
      ? undefined
      : exactWorkspaceText(entry.text, `${label}.text`, MAX_LAYOUT_TEXT_CHARS);
    if (entry.character !== undefined && typeof entry.character !== "boolean") {
      throw new Error(`${label}.character must be a boolean`);
    }
    if (entry.needsReview !== undefined && typeof entry.needsReview !== "boolean") {
      throw new Error(`${label}.needsReview must be a boolean`);
    }
    return {
      id,
      label: boxLabel,
      caption,
      ...(text !== undefined ? { text } : {}),
      ...(entry.character === true ? { character: true } : {}),
      ...(entry.needsReview === true ? { needsReview: true } : {}),
      bbox: workspaceBBox(entry.bbox, `${label}.bbox`),
    };
  });
  return { version: 1, canvas: { width, height }, boxes };
}

/**
 * Write path rejects an invalid draft; the read path drops it so a damaged
 * canvas never costs the rest of the workspace (terms, layer, archive).
 */
function parseWorkspaceLayout(
  value: unknown,
  tolerate: boolean,
): PromptMossLayoutDraft | undefined {
  if (value === undefined || value === null) return undefined;
  try {
    return readWorkspaceLayout(value);
  } catch (error) {
    if (!tolerate) throw error;
    console.warn("Ignoring invalid orchestrator canvas draft", error);
    return undefined;
  }
}

function parseWorkspaceState(
  value: unknown,
  tolerateLayout = false,
): PromptOrchestratorWorkspaceState {
  if (!isRecord(value)) {
    throw new Error("Orchestrator workspace state must be an object");
  }
  if (!Array.isArray(value.prefabTerms) || value.prefabTerms.length > MAX_WORKSPACE_TERMS) {
    throw new Error(
      `Workspace prefabTerms must be an array of at most ${MAX_WORKSPACE_TERMS} items`,
    );
  }
  const seen = new Set<string>();
  const prefabTerms: PromptOrchestratorWorkspaceTerm[] = [];
  value.prefabTerms.forEach((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`prefabTerms[${index}] must be an object`);
    }
    const id = workspaceText(entry.id, `prefabTerms[${index}].id`, 500);
    if (seen.has(id)) return;
    seen.add(id);
    const validationStatus = entry.validationStatus;
    if (typeof validationStatus !== "string" || !TERM_VALIDATION_STATES.has(validationStatus)) {
      throw new Error(`Unsupported prefab term validation status: ${String(validationStatus)}`);
    }
    const state = entry.state;
    if (typeof state !== "string" || !PICKER_STATES.has(state)) {
      throw new Error(`Unsupported prefab term state: ${String(state)}`);
    }
    prefabTerms.push({
      id,
      category: workspaceText(entry.category, `prefabTerms[${index}].category`, 60),
      subcategory: optionalWorkspaceText(entry.subcategory, `prefabTerms[${index}].subcategory`, 200),
      en: workspaceText(entry.en, `prefabTerms[${index}].en`, 2000),
      zh: optionalWorkspaceText(entry.zh, `prefabTerms[${index}].zh`, 2000),
      series: optionalWorkspaceText(entry.series, `prefabTerms[${index}].series`, 200),
      template: optionalWorkspaceText(entry.template, `prefabTerms[${index}].template`, 4000),
      validationStatus: validationStatus as PromptOrchestratorWorkspaceTerm["validationStatus"],
      state: state as PromptOrchestratorWorkspaceTerm["state"],
    });
  });
  const layout = parseWorkspaceLayout(value.mossLayout, tolerateLayout);
  const knowledgePackIds = workspaceIdList(value.knowledgePackIds, "knowledgePackIds");
  const knowledgeModuleIds = workspaceIdList(value.knowledgeModuleIds, "knowledgeModuleIds");
  const knowledgeContractGroup = workspaceContractGroup(value.knowledgeContractGroup);
  const referenceItemIds = workspaceIdList(value.referenceItemIds, "referenceItemIds");
  if (referenceItemIds.length > 3) {
    throw new Error("referenceItemIds must contain at most 3 ids");
  }
  return {
    prefabTerms,
    modelId: typeof value.modelId === "string"
      ? optionalWorkspaceText(value.modelId, "modelId", 500) ?? ""
      : "",
    loraIds: typeof value.loraIds === "string"
      ? optionalWorkspaceText(value.loraIds, "loraIds", 500) ?? ""
      : "",
    ...workspaceLayerState(value),
    ...(layout !== undefined ? { mossLayout: layout } : {}),
    ...(knowledgePackIds.length > 0 ? { knowledgePackIds } : {}),
    ...(knowledgeModuleIds.length > 0 ? { knowledgeModuleIds } : {}),
    ...(knowledgeContractGroup ? { knowledgeContractGroup } : {}),
    ...(referenceItemIds.length > 0 ? { referenceItemIds } : {}),
  };
}

function workspaceContractGroup(
  value: unknown,
): "script" | "storyboard" | "novel" | undefined {
  if (value === undefined || value === null) return undefined;
  if (value === "script" || value === "storyboard" || value === "novel") return value;
  throw new Error("knowledgeContractGroup must be script, storyboard or novel");
}

const MAX_KNOWLEDGE_SELECTION_IDS = 200;

/** Knowledge selection ids are bounded, non-empty strings; duplicates collapse. */
function workspaceIdList(value: unknown, label: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_KNOWLEDGE_SELECTION_IDS) {
    throw new Error(`${label} must be an array of at most ${MAX_KNOWLEDGE_SELECTION_IDS} ids`);
  }
  const seen = new Set<string>();
  const ids: string[] = [];
  value.forEach((entry, index) => {
    const id = workspaceText(entry, `${label}[${index}]`, 200);
    if (seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  });
  return ids;
}

function workspaceNullableId(value: unknown, label: string): string | null | undefined {
  if (value === null) return null;
  if (value === undefined) return undefined;
  return optionalWorkspaceText(value, label, 200);
}

function workspaceLayerState(
  value: Record<string, unknown>,
): Pick<
  PromptOrchestratorWorkspaceState,
  | "systemLayerText"
  | "systemLayerSource"
  | "writingPresetId"
  | "writingPresetVariant"
  | "writingPresetSectionIds"
> {
  const sectionIds = value.writingPresetSectionIds;
  if (
    sectionIds !== undefined &&
    (!Array.isArray(sectionIds) ||
      sectionIds.length > 200 ||
      sectionIds.some((id) => typeof id !== "string" || !id.trim() || id.length > 200))
  ) {
    throw new Error("writingPresetSectionIds must be an array of at most 200 short ids");
  }
  const variantValue = value.writingPresetVariant;
  if (variantValue !== undefined && variantValue !== "compressed" && variantValue !== "original") {
    throw new Error("writingPresetVariant must be compressed or original");
  }
  const variant = variantValue as "compressed" | "original" | undefined;
  const layerText = optionalWorkspaceText(
    value.systemLayerText,
    "systemLayerText",
    MAX_WRITING_LAYER_CHARS,
  );
  return {
    ...(layerText ? { systemLayerText: layerText } : {}),
    ...(workspaceNullableId(value.systemLayerSource, "systemLayerSource") !== undefined
      ? { systemLayerSource: workspaceNullableId(value.systemLayerSource, "systemLayerSource") }
      : {}),
    ...(workspaceNullableId(value.writingPresetId, "writingPresetId") !== undefined
      ? { writingPresetId: workspaceNullableId(value.writingPresetId, "writingPresetId") }
      : {}),
    ...(variant !== undefined ? { writingPresetVariant: variant } : {}),
    ...(sectionIds !== undefined
      ? { writingPresetSectionIds: (sectionIds as string[]).map((id) => id.trim()) }
      : {}),
  };
}

export class DesktopPromptOrchestratorService {
  private readonly vocabulary: PromptVocabDB;
  private readonly feedback: PromptFeedbackDB;
  private readonly workspace: PromptOrchestratorStateDB;

  constructor(db: Database.Database) {
    this.vocabulary = new PromptVocabDB(db);
    this.feedback = new PromptFeedbackDB(db);
    this.workspace = new PromptOrchestratorStateDB(db);
  }

  getWorkspaceState(): PromptOrchestratorWorkspaceState | null {
    const stored = this.workspace.get();
    if (!stored) return null;
    try {
      return parseWorkspaceState(stored, true);
    } catch (error) {
      console.warn("Ignoring corrupted orchestrator workspace state", error);
      return null;
    }
  }

  saveWorkspaceState(value: unknown): PromptOrchestratorWorkspaceState {
    return this.workspace.save(parseWorkspaceState(value));
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

  async run(
    value: unknown,
    onEvent?: (event: PromptOrchestratorStreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<PromptOrchestrationResult> {
    const request = parseRequest(value);
    const orchestrator = new PromptOrchestrator({
      vocabulary: this.vocabulary,
      llm: this.createLlm(request.llmModelId, signal),
      ...(onEvent ? { onEvent } : {}),
      ...(signal ? { signal } : {}),
    });
    return orchestrator.orchestrate(request.input);
  }

  /**
   * Preview of what the writing layer can spend under a declared context.
   * The orchestrator repeats this check on the real input, so the preview can
   * never authorize a layer the final request would reject.
   */
  getLayerBudget(value: unknown): PromptWritingLayerBudgetPreview {
    if (!isRecord(value)) throw new Error("Layer budget input must be an object");
    const contextTokens = optionalInteger(value.contextTokens, 4096, 131_072, "contextTokens");
    const outputReserveTokens = optionalInteger(value.outputReserveTokens, 256, 65_536, "outputReserveTokens");
    const vocabularyTokenBudget = optionalInteger(value.vocabularyTokenBudget, 0, 4000, "vocabularyTokenBudget");
    const imageCount = optionalInteger(value.imageCount, 0, 4, "imageCount") ?? 0;
    const skill = value.skill;
    if (
      skill !== undefined &&
      skill !== "moodyMoss" &&
      skill !== "moss" &&
      skill !== "k2" &&
      skill !== "minimaxH3"
    ) {
      throw new Error(`Unsupported prompt rule skill: ${String(skill)}`);
    }
    const normalizedSkill = skill as PromptOrchestrationInput["skill"];
    const mode = value.mode;
    if (mode !== undefined && typeof mode !== "string") {
      throw new Error("Layer budget mode must be a string");
    }
    const outputFormat = value.outputFormat;
    if (outputFormat !== undefined && typeof outputFormat !== "string") {
      throw new Error("Layer budget outputFormat must be a string");
    }
    const budget = resolveSystemPromptLayerBudget(
      {
        ...(normalizedSkill !== undefined ? { skill: normalizedSkill } : {}),
        ...(mode !== undefined ? { mode: mode as PromptOrchestrationInput["mode"] } : {}),
        ...(outputFormat !== undefined
          ? { outputFormat: outputFormat as PromptOrchestrationInput["outputFormat"] }
          : {}),
        ...(imageCount > 0
          ? { imageUrls: Array.from({ length: imageCount }, () => "data:image/png;base64,x") }
          : {}),
      },
      "",
      {
        ...(contextTokens !== undefined ? { contextTokens } : {}),
        ...(outputReserveTokens !== undefined ? { outputReserveTokens } : {}),
        ...(vocabularyTokenBudget !== undefined ? { vocabularyTokenBudget } : {}),
      },
    );
    return {
      contextTokens: budget.contextTokens,
      outputReserveTokens: budget.outputReserveTokens,
      contractTokens: budget.contractTokens,
      inputTokens: budget.inputTokens,
      vocabularyTokens: budget.vocabularyTokens,
      imageTokens: budget.imageTokens,
      safetyTokens: budget.safetyTokens,
      budgetTokens: budget.budgetTokens,
    };
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

  async refineLayoutCaptions(
    value: unknown,
    signal?: AbortSignal,
  ): Promise<PromptMossCaptionRefinement> {
    if (!isRecord(value) || !isRecord(value.draft)) {
      throw new Error("Layout caption input must contain a draft object");
    }
    const orchestrator = new PromptOrchestrator({
      vocabulary: this.vocabulary,
      llm: this.createLlm(optionalModelId(value.llmModelId), signal),
      ...(signal ? { signal } : {}),
    });
    return orchestrator.refineLayoutCaptions({
      draft: value.draft as unknown as PromptMossLayoutDraft,
      ...(typeof value.intent === "string" ? { intent: value.intent } : {}),
    });
  }

  async reverseLayout(
    value: unknown,
    signal?: AbortSignal,
  ): Promise<PromptMossLayoutReverse> {
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
      llm: this.createLlm(optionalModelId(value.llmModelId), signal),
      ...(signal ? { signal } : {}),
    });
    return orchestrator.reverseLayoutFromImage({
      images,
      canvas: { width, height },
      ...(typeof value.intent === "string" ? { intent: value.intent } : {}),
    });
  }

  private createLlm(llmModelId?: string, signal?: AbortSignal): OpenAiCompatiblePromptLlm {
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
      ...(signal ? { signal } : {}),
    });
  }
}
