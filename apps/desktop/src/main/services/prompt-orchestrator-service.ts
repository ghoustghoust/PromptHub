import {
  OpenAiCompatiblePromptLlm,
  PromptOrchestrator,
  PromptSkillGenerator,
  coreAIConfigService,
  type CoreAIModelConfig,
} from "@prompthub/core";
import { PromptVocabDB } from "@prompthub/db";
import type Database from "@prompthub/db/adapter";
import type {
  DesktopPromptOrchestrationRequest,
  DesktopPromptSkillGenerationRequest,
  PromptOrchestrationInput,
  PromptOrchestrationResult,
  PromptSkillDraft,
  PromptVocabularySearchInput,
  PromptVocabularySearchItem,
} from "@prompthub/shared/types";

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

export class DesktopPromptOrchestratorService {
  private readonly vocabulary: PromptVocabDB;

  constructor(db: Database.Database) {
    this.vocabulary = new PromptVocabDB(db);
  }

  listSeries(): string[] {
    return this.vocabulary.listSeries();
  }

  searchTerms(value: unknown): PromptVocabularySearchItem[] {
    if (!isRecord(value)) throw new Error("Vocabulary search input must be an object");
    return this.vocabulary.searchTerms(value as PromptVocabularySearchInput);
  }

  async run(value: unknown): Promise<PromptOrchestrationResult> {
    const request = parseRequest(value);
    const orchestrator = new PromptOrchestrator({
      vocabulary: this.vocabulary,
      llm: this.createLlm(request.llmModelId),
    });
    return orchestrator.orchestrate(request.input);
  }

  async generateSkill(value: unknown): Promise<PromptSkillDraft> {
    const request = parseSkillRequest(value);
    const generator = new PromptSkillGenerator({
      vocabulary: this.vocabulary,
      llm: this.createLlm(request.llmModelId),
    });
    return generator.generate(request.input, request.skillName);
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
