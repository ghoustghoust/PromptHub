import type {
  PromptOrchestrationMode,
  PromptOrchestrationOutputFormat,
  PromptOrchestrationSkill,
} from "@prompthub/shared/types";
import { isVideoOrchestrationMode } from "@prompthub/shared/types";

export const IMAGE_TASK_MODES = [
  "expand",
  "professional",
  "polish",
  "reverse",
  "edit",
  "random",
] as const satisfies readonly PromptOrchestrationMode[];

export const VIDEO_TASK_MODES = [
  "video-text",
  "video-frames",
  "video-multi-reference",
  "video-long",
  "video-short-drama",
  "video-beat",
] as const satisfies readonly PromptOrchestrationMode[];

export const AUTHORING_TASK_MODES = [
  ...IMAGE_TASK_MODES,
  ...VIDEO_TASK_MODES,
] as const satisfies readonly PromptOrchestrationMode[];

export function taskModesForSkill(
  skill: PromptOrchestrationSkill,
): readonly PromptOrchestrationMode[] {
  return skill === "minimaxH3" ? VIDEO_TASK_MODES : IMAGE_TASK_MODES;
}

export function defaultModeForSkill(
  skill: PromptOrchestrationSkill,
): PromptOrchestrationMode {
  return skill === "minimaxH3" ? "video-text" : "expand";
}

export const PREFAB_CATEGORIES = [
  "style",
  "artist",
  "body",
  "face",
  "hair",
  "clothing",
  "accessory",
  "pose",
  "expression",
  "environment",
  "weather",
  "props",
  "lighting",
  "composition",
  "camera",
] as const;

export function isVideoTask(mode: PromptOrchestrationMode): boolean {
  return isVideoOrchestrationMode(mode);
}

export function defaultOutputFormat(
  mode: PromptOrchestrationMode,
  skill: PromptOrchestrationSkill,
): PromptOrchestrationOutputFormat {
  if (mode === "video-short-drama") return "agent-system";
  if (isVideoTask(mode)) return "h3";
  return skill === "moss" ? "caption" : "caption";
}

export function outputFormatOptions(
  mode: PromptOrchestrationMode,
  skill: PromptOrchestrationSkill,
): PromptOrchestrationOutputFormat[] {
  if (mode === "video-short-drama") return ["agent-system"];
  if (isVideoTask(mode)) return ["h3"];
  if (skill === "moss") return ["caption", "tags", "layout"];
  if (skill === "k2") return ["caption"];
  return ["caption", "layout"];
}

export function referenceImageLimit(mode: PromptOrchestrationMode): number {
  if (mode === "video-frames") return 2;
  if (mode === "video-multi-reference") return 6;
  if (mode === "video-long") return 2;
  return 4;
}
