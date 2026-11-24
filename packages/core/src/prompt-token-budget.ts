import type {
  PromptOrchestrationResult,
  PromptSelectedTerm,
} from "@prompthub/shared/types";
import { estimatePromptTokens } from "@prompthub/shared/utils/prompt-token-estimate";

export { estimatePromptTokens };

export function estimateVocabularyTokens(
  terms: PromptSelectedTerm[],
): number {
  return terms.reduce(
    (total, term) =>
      total + estimatePromptTokens(term.template?.trim() || term.en) + 8,
    0,
  );
}

export function estimateResultTokenMetrics(
  initialPrompt: string,
  completePrompt: string,
  terms: PromptSelectedTerm[],
): PromptOrchestrationResult["tokenMetrics"] {
  return {
    initialPromptTokens: estimatePromptTokens(initialPrompt),
    completePromptTokens: estimatePromptTokens(completePrompt),
    vocabularyEstimatedTokens: estimateVocabularyTokens(terms),
    method: "estimate",
  };
}

export function mossBudgetWarnings(
  completePromptTokens: number,
): string[] {
  if (completePromptTokens > 2500) {
    return [
      "MOSS metric only: output is beyond the ~2500-token reference plateau. Redundancy is allowed; do not truncate or remove content solely to hit this range.",
    ];
  }
  if (completePromptTokens < 500) {
    return [
      "MOSS metric only: output is in the 50-500 token reference range. This is not a requirement to expand or stop; preserve complete semantics.",
    ];
  }
  if (completePromptTokens < 2000) {
    return [
      "MOSS metric only: output is in the 500-2000 token reference range. Do not use this metric to shorten or terminate the description.",
    ];
  }
  return [];
}
