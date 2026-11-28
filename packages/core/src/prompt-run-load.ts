import type {
  PromptOrchestrationInput,
  PromptRunLoad,
  PromptTaskContract,
} from "@prompthub/shared/types";
import { buildCompositionMessages } from "./prompt-orchestrator-composition";
import { getPromptRuleCard } from "./prompt-orchestrator-rule-cards";
import { buildReferenceStyleText } from "@prompthub/shared/utils/prompt-reference";
import { estimatePromptTokens } from "@prompthub/shared/utils/prompt-token-estimate";

/** Matches the budget layer's per-image placeholder cost. */
const IMAGE_TOKENS = 1024;

export interface RunLoadOptions {
  input: PromptOrchestrationInput;
  contract: PromptTaskContract;
  completionTokens: number;
  retrieval?: { rounds: number; queryCount: number; candidateCount: number };
  /** Tokens accumulated by intermediate turns (tool loop or polish planning). */
  historyTokens?: number;
  elapsedMs: number;
  toolCalls: number;
  /** Tokens of the vocabulary rows handed to the model; estimated by callers. */
  vocabularyTokens?: number;
}

function writingLayerSplit(input: PromptOrchestrationInput): {
  layer: number;
  knowledge: number;
} {
  const layer = estimatePromptTokens(input.systemPromptLayer?.trim() ?? "");
  const modules = (input.knowledgeModules ?? [])
    .map((module) => `${module.title}\n${module.content ?? ""}`)
    .join("\n\n");
  return { layer, knowledge: estimatePromptTokens(modules) };
}

/**
 * Deterministic estimate of where one run's tokens went. It prices the layers
 * separately so "the context is full" can be traced to rules, writing layer,
 * knowledge, references, candidates, images or intermediate turns.
 */
export function buildRunLoad(options: RunLoadOptions): PromptRunLoad {
  const { input, contract } = options;
  const ruleCard = estimatePromptTokens(
    getPromptRuleCard(input.skill, { allowAdult: input.allowAdult }),
  );
  const reference = estimatePromptTokens(
    buildReferenceStyleText(input.referenceStyles ?? []),
  );
  const { layer: writingLayer, knowledge } = writingLayerSplit(input);
  const messages = buildCompositionMessages(input, [], [], []);
  const systemTokens = estimatePromptTokens(messages.system);
  const contractTokens = Math.max(
    0,
    systemTokens - ruleCard - reference - writingLayer - knowledge,
  );
  const images = (input.imageUrls?.length ?? 0) * IMAGE_TOKENS;

  const breakdown: PromptRunLoad["breakdown"] = {
    ruleCard,
    contract: contractTokens,
    writingLayer,
    knowledge,
    reference,
    vocabulary: Math.max(0, options.vocabularyTokens ?? 0),
    images,
    history: Math.max(0, options.historyTokens ?? 0),
  };
  const promptTokens = Object.values(breakdown).reduce(
    (total, part) => total + part,
    0,
  );

  return {
    method: "estimate",
    promptTokens,
    completionTokens: Math.max(0, options.completionTokens),
    totalTokens: promptTokens + Math.max(0, options.completionTokens),
    breakdown,
    rounds: options.retrieval?.rounds ?? 0,
    toolCalls: Math.max(0, options.toolCalls),
    candidates: options.retrieval?.candidateCount ?? 0,
    elapsedMs: Math.max(0, Math.round(options.elapsedMs)),
    taskKind: contract.taskKind,
    modelTools: contract.retrieval.modelTools,
  };
}