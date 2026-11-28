import type {
  PromptOrchestrationInput,
  PromptScriptStage,
} from "@prompthub/shared/types";
import {
  DEFAULT_SCRIPT_SHOT_COUNT,
  MAX_SCRIPT_SHOT_COUNT,
} from "./prompt-script-flow";

export interface PromptStageContract {
  stage: PromptScriptStage;
  /** Only for the storyboard stage: how many shots the user asked for. */
  requiredShotCount?: number;
  /** System-prompt text for this stage; empty string means no extra rules. */
  system: string;
}

const CN_DIGIT: Record<string, number> = {
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

function parseChineseNumber(text: string): number | null {
  if (text === "十") return 10;
  if (text.startsWith("十")) {
    const rest = CN_DIGIT[text.slice(1)];
    return rest ? 10 + rest : null;
  }
  const tens = text.match(/^([一二两三四五六七八九])十([一二三四五六七八九])?$/);
  if (tens) {
    const head = CN_DIGIT[tens[1]];
    const tail = tens[2] ? CN_DIGIT[tens[2]] : 0;
    return head * 10 + tail;
  }
  const single = CN_DIGIT[text];
  return single ?? null;
}

function isUsableShotCount(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_SCRIPT_SHOT_COUNT
  );
}

/**
 * Shot count: an explicit panel setting wins, then a number named in the
 * intent (「六个分镜」「8 个分镜」「十二镜」), then the default.
 */
export function resolveRequestedShotCount(
  prompt: string | undefined,
  explicit?: number,
): number {
  if (isUsableShotCount(explicit)) return explicit;
  const text = prompt ?? "";
  const arabic = text.match(/(\d{1,2})\s*(?:个|格|张)?\s*(?:分镜|镜头|镜|shots?)/i);
  if (arabic) {
    const value = Number.parseInt(arabic[1], 10);
    if (Number.isFinite(value) && value >= 1 && value <= 60) return value;
  }
  const chinese = text.match(/([一二两三四五六七八九十]{1,3})\s*(?:个|格)?\s*(?:分镜|镜头|镜)/);
  if (chinese) {
    const value = parseChineseNumber(chinese[1]);
    if (value && value >= 1 && value <= 60) return value;
  }
  return DEFAULT_SCRIPT_SHOT_COUNT;
}

function outlineText(): string {
  return [
    "This stage produces an outline in beats.",
    "Write one beat per line and keep the order of events. If the user asks for a number of beats (for example four beats), write exactly that many lines: do not merge them into one sentence and do not drop beats. Keep every beat's unresolved tension and do not compress, summarize or skip material that later stages will need; length follows the story, so a long story gets a long outline. Do not add a new ending that the user did not ask for.",
  ].join(" ");
}

function scriptText(): string {
  return [
    "This stage produces script pages in four blocks, the way a screenplay is written: scene heading, action lines, character cue, dialogue.",
    "Scene heading: `INT.` or `EXT.`, the location, and the time (`NIGHT`, `DAY`, `CONTINUOUS`).",
    "Action lines: present tense, active voice, only what the camera can see. No inner thoughts and no camera language such as close-up or push-in; keep paragraphs to three to five lines.",
    "Character cue and dialogue: the speaker name in capitals (a Chinese name followed by a colon is fine), then one or two spoken lines. At least one line is required; when the material has none, invent a short line that fits the scene.",
    "Write the whole page in the language of the user's intent and step material; only INT./EXT. stays as a marker. The caption rule card's single-paragraph shape does not apply to this stage.",
    "Inside the required JSON object, the completePrompt value must be the script page itself: heading, action, character cue and line. A page with no spoken line is incomplete, so finish it before answering, but still return the JSON object the output contract asks for.",
  ].join(" ");
}

function storyboardText(shotCount: number): string {
  return [
    `This stage produces a storyboard table with exactly ${shotCount} shots, one shot per line, numbered 分镜一 … 分镜${shotCount}.`,
    "For every shot fill: shot number, shot size (wide / medium / close / insert), angle or camera position, movement (static / push / pull / pan / handheld), the visual line (subject + action + environment + lighting), and the duration in seconds.",
    "Inside the required JSON object, the completePrompt value must contain exactly that many numbered shot lines; count them before answering, and a shorter list is wrong even when the beats feel sufficient. Do not merge beats to reach a smaller number, and do not invent new story to reach a larger one. If the request text mentions a different number, the configured count above wins. Put dialogue only in the shots where it is spoken.",
  ].join(" ");
}

function unitText(durationSeconds: number, shotCount: number): string {
  const count = shotCount > 0 ? shotCount : 4;
  return [
    `This stage produces a shot-ready prompt for ${durationSeconds} seconds, split into ${count} timed shots.`,
    "Give each shot an explicit time range, framing and action, then add the soundscape; keep the people, places and event order of the storyboard.",
  ].join(" ");
}

/**
 * The output shape a script stage owes, independent of the model rule card.
 * Only the fields the stage needs are filled; nothing is invented for stages
 * the user has not declared.
 */
export function resolveStageContract(
  input: PromptOrchestrationInput,
): PromptStageContract | null {
  const stage = input.stage;
  if (!stage) return null;
  if (stage === "outline") {
    return { stage, system: outlineText() };
  }
  if (stage === "script") {
    return { stage, system: scriptText() };
  }
  if (stage === "storyboard") {
    const requiredShotCount = resolveRequestedShotCount(input.prompt, input.shotCount);
    return { stage, requiredShotCount, system: storyboardText(requiredShotCount) };
  }
  const durationSeconds = input.video?.durationSeconds ?? 8;
  const shotCount = input.video?.shotCount ?? 0;
  return { stage, system: unitText(durationSeconds, shotCount) };
}