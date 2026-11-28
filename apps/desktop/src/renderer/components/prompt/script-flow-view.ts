import {
  SCRIPT_STAGE_ORDER,
  currentScriptVersion,
  nextScriptStage,
  staleScriptStages,
  type PromptScriptFlow,
  type PromptScriptStage,
} from "@prompthub/core/prompt-script-flow";

export type ScriptStageStatus = "done" | "next" | "stale" | "empty";

/** What the stage badge should say, given the stored flow. */
export function scriptStageStatus(
  flow: PromptScriptFlow,
  stage: PromptScriptStage,
): ScriptStageStatus {
  const current = currentScriptVersion(flow, stage);
  if (!current) return stage === nextScriptStage(flow) ? "next" : "empty";
  return staleScriptStages(flow).includes(stage) ? "stale" : "done";
}

/**
 * A stage can be written once its immediate upstream exists. Revising a stage
 * that already has text is always allowed.
 */
export function canSaveStage(flow: PromptScriptFlow, stage: PromptScriptStage): boolean {
  const index = SCRIPT_STAGE_ORDER.indexOf(stage);
  if (index < 0) return false;
  if (currentScriptVersion(flow, stage)) return true;
  if (index === 0) return true;
  return currentScriptVersion(flow, SCRIPT_STAGE_ORDER[index - 1]) !== undefined;
}

/** Stored versions newest first, shaped for the version picker. */
export function stageVersions(
  flow: PromptScriptFlow,
  stage: PromptScriptStage,
): Array<{ version: number; text: string }> {
  return [...flow.versions[stage]]
    .reverse()
    .map((item) => ({ version: item.version, text: item.text }));
}