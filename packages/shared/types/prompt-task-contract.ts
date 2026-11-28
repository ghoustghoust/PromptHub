import type {
  PromptGuidanceMode,
  PromptOrchestrationOutputFormat,
  PromptOrchestrationSkill,
} from "./prompt-orchestrator";

/** Task structure the run actually performs, derived from the mode. */
export type PromptTaskKind =
  | "expand"
  | "professional"
  | "polish"
  | "reverse"
  | "edit"
  | "random"
  | "json"
  | "lora"
  | "video-text"
  | "video-frames"
  | "video-multi-reference"
  | "video-long"
  | "video-short-drama"
  | "video-beat";

/**
 * Resources one run may touch. `explicit` means only the user's own selection
 * can introduce it; `automatic` means the system may retrieve it on its own.
 */
export type PromptTaskResourceKey =
  | "systemPromptLayer"
  | "stepContext"
  | "knowledge"
  | "reference"
  | "vocabulary"
  | "vocabularyRetrieval"
  | "images"
  | "layout"
  | "video"
  | "assets";

export type PromptTaskContractReason =
  | "agent-led-automatic-retrieval"
  | "human-led-no-automatic-retrieval"
  | "reverse-with-images-single-shot"
  | "layout-deterministic-compile"
  | "video-single-pass"
  | "explicit-user-resource"
  | "pipeline-upstream-context"
  | "resource-not-consumed";

export type PromptTaskRejectionReason =
  | "video-ignored-for-image-task"
  | "layout-ignored-for-non-layout-task"
  | "layout-ignored-for-video-task"
  | "images-ignored-for-text-task";

export interface PromptTaskResourceRule {
  allowed: boolean;
  source: "explicit" | "automatic" | "unavailable";
  reason: PromptTaskContractReason;
}

/**
 * How many vendor turns and tool calls the run may spend, and whether the
 * model may widen a search to exploratory recall. Identity/LoRA paths stay
 * exact by policy regardless of these numbers.
 */
export interface PromptTaskRetrievalRules {
  automatic: boolean;
  modelTools: boolean;
  maxRounds: number;
  maxToolCalls: number;
  allowExploratory: boolean;
}

/**
 * Deterministic description of what one run is allowed to do before any model
 * call. The orchestrator, the tool layer and the budget preview all read this
 * same object, so UI promises and actual injection cannot drift apart.
 */
export interface PromptTaskContract {
  taskKind: PromptTaskKind;
  media: "image" | "video";
  guidanceMode: PromptGuidanceMode;
  outputFormat: PromptOrchestrationOutputFormat;
  skill: PromptOrchestrationSkill;
  /** `creative` lets the model write; `dispatch` assembles a structured target. */
  writing: "creative" | "dispatch";
  resources: Record<PromptTaskResourceKey, PromptTaskResourceRule>;
  retrieval: PromptTaskRetrievalRules;
  /** Explicit input the current task refuses to consume, with a stable reason code. */
  rejectedResources: Array<{
    resource: PromptTaskResourceKey;
    reason: PromptTaskRejectionReason;
  }>;
  reasons: PromptTaskContractReason[];
  /** Stable identity of this contract, safe to store with execution evidence. */
  signature: string;
}