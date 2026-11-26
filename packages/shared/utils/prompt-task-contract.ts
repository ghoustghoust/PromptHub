import type {
  PromptOrchestrationInput,
  PromptOrchestrationSkill,
  PromptGuidanceMode,
} from "@prompthub/shared/types/prompt-orchestrator";
import type {
  PromptTaskContract,
  PromptTaskContractReason,
  PromptTaskKind,
  PromptTaskRejectionReason,
  PromptTaskResourceKey,
  PromptTaskResourceRule,
} from "@prompthub/shared/types/prompt-task-contract";

/**
 * Mirrors the tool layer: these four modes can ask the vocabulary tools for
 * knowledge. Video and layout runs stay single-pass.
 */
const TOOL_MODES: ReadonlySet<string> = new Set([
  "expand",
  "professional",
  "polish",
  "reverse",
]);

const MAX_TOOL_ROUNDS = 4;
const MAX_TOOL_CALLS = 6;

/** Modes that genuinely read supplied pictures; `edit` is included on purpose. */
const IMAGE_MODES: ReadonlySet<string> = new Set([
  "reverse",
  "edit",
  "video-frames",
  "video-multi-reference",
  "video-long",
]);

const DEFAULT_SKILL: PromptOrchestrationSkill = "moodyMoss";
const DEFAULT_OUTPUT_FORMAT = "caption";
const DEFAULT_GUIDANCE: PromptGuidanceMode = "agent-led";

export interface AppliedPromptTaskContract {
  input: PromptOrchestrationInput;
  contract: PromptTaskContract;
}

export const TASK_CONTRACT_WARNINGS: Record<PromptTaskRejectionReason, string> = {
  "video-ignored-for-image-task":
    "Video parameters were ignored because the current task produces an image prompt.",
  "layout-ignored-for-non-layout-task":
    "The layout draft was ignored because this task does not compile a MOSS layout.",
  "layout-ignored-for-video-task":
    "The layout draft was ignored because a video task must not consume the MOSS layout canvas.",
  "images-ignored-for-text-task":
    "Reference images were ignored because this task does not read images.",
};

function isVideoMode(mode: string): boolean {
  return mode.startsWith("video-");
}

function taskKindOf(mode: string): PromptTaskKind {
  switch (mode) {
    case "professional":
    case "polish":
    case "reverse":
    case "edit":
    case "random":
    case "json":
    case "lora":
    case "video-text":
    case "video-frames":
    case "video-multi-reference":
    case "video-long":
    case "video-short-drama":
    case "video-beat":
      return mode;
    default:
      return "expand";
  }
}

function rule(
  allowed: boolean,
  source: PromptTaskResourceRule["source"],
  reason: PromptTaskContractReason,
): PromptTaskResourceRule {
  return { allowed, source, reason };
}

function hashSignature(payload: unknown): string {
  const text = JSON.stringify(payload);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Derives the single contract a run works under. Pure: the same input always
 * yields the same contract, and the caller's object is never modified here.
 */
export function resolvePromptTaskContract(
  input: PromptOrchestrationInput,
): PromptTaskContract {
  const mode = input.mode ?? "expand";
  const video = isVideoMode(mode);
  const guidanceMode = input.guidanceMode ?? DEFAULT_GUIDANCE;
  const outputFormat = input.outputFormat ?? DEFAULT_OUTPUT_FORMAT;
  const skill = input.skill ?? DEFAULT_SKILL;
  const taskKind = taskKindOf(mode);
  const imageCount = input.imageUrls?.length ?? 0;
  const agentLed = guidanceMode === "agent-led";
  const layoutAllowed = outputFormat === "layout" && !video;
  const reasonBase: PromptTaskContractReason = agentLed
    ? "agent-led-automatic-retrieval"
    : "human-led-no-automatic-retrieval";

  const reverseWithImages = mode === "reverse" && imageCount > 0;
  const modelTools =
    agentLed &&
    outputFormat !== "layout" &&
    TOOL_MODES.has(mode) &&
    !reverseWithImages;
  const automatic = agentLed;
  const allowExploratory = agentLed && mode !== "reverse";
  const imagesAllowed = IMAGE_MODES.has(mode);

  const retrievalReason: PromptTaskContractReason = !agentLed
    ? "human-led-no-automatic-retrieval"
    : reverseWithImages
      ? "reverse-with-images-single-shot"
      : video
        ? "video-single-pass"
        : modelTools
          ? "agent-led-automatic-retrieval"
          : outputFormat === "layout"
            ? "layout-deterministic-compile"
            : "agent-led-automatic-retrieval";

  const rejectedResources: PromptTaskContract["rejectedResources"] = [];
  if (!video && input.video !== undefined) {
    rejectedResources.push({
      resource: "video",
      reason: "video-ignored-for-image-task",
    });
  }
  if (input.layout !== undefined && !layoutAllowed) {
    rejectedResources.push({
      resource: "layout",
      reason: video
        ? "layout-ignored-for-video-task"
        : "layout-ignored-for-non-layout-task",
    });
  }
  if (imageCount > 0 && !imagesAllowed) {
    rejectedResources.push({
      resource: "images",
      reason: "images-ignored-for-text-task",
    });
  }

  const resources: Record<PromptTaskResourceKey, PromptTaskResourceRule> = {
    systemPromptLayer: rule(true, "explicit", "explicit-user-resource"),
    knowledge: rule(true, "explicit", "explicit-user-resource"),
    reference: rule(true, "explicit", "explicit-user-resource"),
    vocabulary: rule(automatic, "automatic", reasonBase),
    vocabularyRetrieval: rule(modelTools, "automatic", retrievalReason),
    images: rule(imagesAllowed, "explicit", "explicit-user-resource"),
    layout: rule(layoutAllowed, "explicit", "layout-deterministic-compile"),
    video: rule(video, "explicit", "explicit-user-resource"),
    assets: rule(false, "unavailable", "resource-not-consumed"),
  };

  const writing: PromptTaskContract["writing"] =
    outputFormat === "layout" ? "dispatch" : "creative";

  const reasons: PromptTaskContractReason[] = [];
  if (!agentLed) reasons.push("human-led-no-automatic-retrieval");
  else reasons.push("agent-led-automatic-retrieval");
  if (reverseWithImages) reasons.push("reverse-with-images-single-shot");
  if (outputFormat === "layout") reasons.push("layout-deterministic-compile");
  if (video) reasons.push("video-single-pass");

  return {
    taskKind,
    media: video ? "video" : "image",
    guidanceMode,
    outputFormat,
    skill,
    writing,
    resources,
    retrieval: {
      automatic,
      modelTools,
      maxRounds: MAX_TOOL_ROUNDS,
      maxToolCalls: MAX_TOOL_CALLS,
      allowExploratory,
    },
    rejectedResources,
    reasons,
    signature: hashSignature({
      taskKind,
      media: video ? "video" : "image",
      guidanceMode,
      outputFormat,
      skill,
      writing,
      resources: Object.fromEntries(
        Object.entries(resources).map(([key, value]) => [key, value.allowed]),
      ),
      retrieval: {
        automatic,
        modelTools,
        allowExploratory,
      },
      rejectedResources,
    }),
  };
}

/**
 * Applies the contract before validation: input the task does not consume is
 * removed instead of silently reaching the model, and every removal is
 * reported through `rejectedResources`.
 */
export function applyPromptTaskContract(
  input: PromptOrchestrationInput,
): AppliedPromptTaskContract {
  const contract = resolvePromptTaskContract(input);
  if (contract.rejectedResources.length === 0) {
    return { input, contract };
  }
  const next: PromptOrchestrationInput = { ...input };
  for (const rejection of contract.rejectedResources) {
    if (rejection.resource === "video") delete next.video;
    if (rejection.resource === "layout") delete next.layout;
    if (rejection.resource === "images") delete next.imageUrls;
  }
  return { input: next, contract };
}

export function taskContractWarnings(
  contract: PromptTaskContract,
): string[] {
  return contract.rejectedResources.map(
    (rejection) => TASK_CONTRACT_WARNINGS[rejection.reason],
  );
}