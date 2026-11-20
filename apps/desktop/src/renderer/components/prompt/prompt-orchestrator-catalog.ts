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

/**
 * Aspect ratios offered by ComfyUI's ResolutionSelector node, in its own order.
 * Keeping this list identical to the node avoids generating a canvas the workflow
 * cannot reproduce.
 */
export const MOSS_ASPECT_RATIOS = [
  { label: "1:1", widthRatio: 1, heightRatio: 1 },
  { label: "2:3", widthRatio: 2, heightRatio: 3 },
  { label: "3:2", widthRatio: 3, heightRatio: 2 },
  { label: "3:4", widthRatio: 3, heightRatio: 4 },
  { label: "4:3", widthRatio: 4, heightRatio: 3 },
  { label: "9:16", widthRatio: 9, heightRatio: 16 },
  { label: "16:9", widthRatio: 16, heightRatio: 9 },
  { label: "21:9", widthRatio: 21, heightRatio: 9 },
] as const;

export const MOSS_CANVAS_MULTIPLE = 16;

/** 1 / 1.5 / 2 MP are the official recommendation; 3 and 4 MP are the extrapolation band. */
export const MOSS_MEGAPIXEL_OPTIONS = ["1", "1.5", "2", "3", "4"] as const;

/** Applied when the user has not picked a megapixel target. */
export const MOSS_DEFAULT_MEGAPIXELS = "1";

export const MOSS_RECOMMENDED_MEGAPIXELS = { min: 1, max: 2 } as const;

/** Python's round() is half-to-even; JavaScript's Math.round is half-up. */
function roundHalfToEven(value: number): number {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

/**
 * Mirrors ComfyUI `ResolutionSelector.execute` exactly:
 * total = mp * 1024 * 1024, scale = sqrt(total / (w * h)), round to `multiple`.
 */
export function mossResolution(
  ratioLabel: string,
  megapixels: number,
  multiple: number = MOSS_CANVAS_MULTIPLE,
): { width: number; height: number } | null {
  const ratio = MOSS_ASPECT_RATIOS.find((entry) => entry.label === ratioLabel);
  if (!ratio || !Number.isFinite(megapixels) || megapixels <= 0) return null;
  const scale = Math.sqrt((megapixels * 1024 * 1024) / (ratio.widthRatio * ratio.heightRatio));
  const width = roundHalfToEven((ratio.widthRatio * scale) / multiple) * multiple;
  const height = roundHalfToEven((ratio.heightRatio * scale) / multiple) * multiple;
  return width > 0 && height > 0 ? { width, height } : null;
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

/** Rule cards whose native canvas contract PromptHub can compile deterministically. */
export function supportsLayoutDraft(skill: PromptOrchestrationSkill): boolean {
  return skill === "moss" || skill === "moodyMoss";
}

export function referenceImageLimit(mode: PromptOrchestrationMode): number {
  if (mode === "video-frames") return 2;
  if (mode === "video-multi-reference") return 6;
  if (mode === "video-long") return 2;
  return 4;
}
