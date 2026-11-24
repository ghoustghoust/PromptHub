/**
 * Deterministic estimate used only for budgeting, not an official model
 * tokenizer: counts words, CJK characters and remaining punctuation as one
 * token each. Shared by the core orchestrator and the renderer so the budget
 * preview matches what the orchestrator will check.
 */
export function estimatePromptTokens(text: string): number {
  return (
    text.match(/[A-Za-z0-9_]+(?:[-'][A-Za-z0-9_]+)*|[\u3400-\u9fff]|[^\s]/g)
      ?.length ?? 0
  );
}
