import type { PromptOrchestrationInput } from "@prompthub/shared/types";
import { MAX_WRITING_LAYER_CHARS } from "@prompthub/shared/utils/prompt-orchestrator-limits";
import { estimatePromptTokens } from "@prompthub/shared/utils/prompt-token-estimate";
import { buildCompositionMessages } from "./prompt-orchestrator-composition";

/** Defaults match the 8K preset; callers must declare a different context explicitly. */
export const DEFAULT_LAYER_CONTEXT_TOKENS = 8192;
export const DEFAULT_LAYER_OUTPUT_RESERVE = 4096;
export const MIN_LAYER_CONTEXT_TOKENS = 4096;
export const MAX_LAYER_CONTEXT_TOKENS = 131_072;
/** Transport/DB guard only; the token budget is the real limit. */
export const MAX_LAYER_CHARS = MAX_WRITING_LAYER_CHARS;
/** Conservative per-image prompt cost on top of the text budget. */
const IMAGE_PROMPT_TOKENS = 1024;

export interface SystemPromptLayerBudget {
  contextTokens: number;
  outputReserveTokens: number;
  contractTokens: number;
  inputTokens: number;
  vocabularyTokens: number;
  imageTokens: number;
  safetyTokens: number;
  /** Tokens left for the writing layer; never negative. */
  budgetTokens: number;
  usedTokens: number;
  overBy: number;
  fits: boolean;
}

export interface SystemPromptLayerBudgetOptions {
  contextTokens?: number;
  outputReserveTokens?: number;
  vocabularyTokenBudget?: number;
}

function clampContext(value: number | undefined): number {
  if (!Number.isInteger(value)) return DEFAULT_LAYER_CONTEXT_TOKENS;
  return Math.min(MAX_LAYER_CONTEXT_TOKENS, Math.max(MIN_LAYER_CONTEXT_TOKENS, value as number));
}

function clampReserve(value: number | undefined, contextTokens: number): number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    return Math.min(DEFAULT_LAYER_OUTPUT_RESERVE, Math.floor(contextTokens / 2));
  }
  return Math.min(value as number, Math.floor(contextTokens / 2));
}

/**
 * Budget for the writing layer. Rule cards, the vocabulary budget, the user's
 * input, image placeholders and an output reserve all share the same context,
 * so the layer gets what is actually left instead of a fixed character cap.
 * The numbers are deterministic estimates; the orchestrator still re-validates.
 */
export function resolveSystemPromptLayerBudget(
  input: PromptOrchestrationInput,
  layerText: string,
  options: SystemPromptLayerBudgetOptions = {},
): SystemPromptLayerBudget {
  const contextTokens = clampContext(options.contextTokens ?? input.systemPromptLayerContextSize);
  const outputReserveTokens = clampReserve(
    options.outputReserveTokens ?? input.systemPromptLayerOutputReserve,
    contextTokens,
  );
  const vocabularyTokens = Math.max(
    0,
    Math.min(4000, Math.floor(options.vocabularyTokenBudget ?? input.vocabularyTokenBudget ?? 900)),
  );
  const stripped: PromptOrchestrationInput = {
    ...input,
    systemPromptLayer: undefined,
    systemPromptLayerSource: undefined,
    systemPromptLayerPresetId: undefined,
    knowledgeModules: undefined,
  };
  const messages = buildCompositionMessages(stripped, [], [], []);
  const contractTokens = estimatePromptTokens(messages.system);
  const inputTokens = estimatePromptTokens(messages.user);
  const imageTokens = (input.imageUrls?.length ?? 0) * IMAGE_PROMPT_TOKENS;
  const safetyTokens = Math.max(256, Math.round(contextTokens * 0.04));
  const fixedCost =
    outputReserveTokens +
    contractTokens +
    inputTokens +
    vocabularyTokens +
    imageTokens +
    safetyTokens;
  const budgetTokens = Math.max(0, contextTokens - fixedCost);
  const usedTokens = estimatePromptTokens(layerText);
  return {
    contextTokens,
    outputReserveTokens,
    contractTokens,
    inputTokens,
    vocabularyTokens,
    imageTokens,
    safetyTokens,
    budgetTokens,
    usedTokens,
    overBy: Math.max(0, usedTokens - budgetTokens),
    fits: usedTokens <= budgetTokens,
  };
}
