import type { PromptOrchestrationInput } from "@prompthub/shared/types";
import type { ScriptFlowState } from "./useScriptFlow";

/**
 * Fields a workbench run owes to the script flow. A run that belongs to no flow
 * and has no step material stays a plain single-shot run; a unit run also
 * declares its material branch so the stage contract can follow it.
 */
export function scriptFlowRunFields(
  state: Pick<ScriptFlowState, "flow" | "stepContext" | "stage" | "shotCount" | "materials">,
): Partial<PromptOrchestrationInput> {
  const stepContext = state.stepContext.trim();
  if (!state.flow && !stepContext) return {};
  return {
    ...(stepContext ? { stepContext: state.stepContext } : {}),
    stage: state.stage,
    shotCount: state.shotCount,
    ...(state.stage === "unit" && state.materials.mode !== "text"
      ? { unitMaterials: state.materials }
      : {}),
  };
}