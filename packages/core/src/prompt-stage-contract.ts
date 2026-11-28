import type {
  PromptOrchestrationInput,
  PromptScriptStage,
} from "@prompthub/shared/types";

export interface PromptStageContract {
  stage: PromptScriptStage;
  /** Only for the storyboard stage: how many shots the user asked for. */
  requiredShotCount?: number;
  /** System-prompt text for this stage; empty string means no extra rules. */
  system: string;
}

const DEFAULT_SHOT_COUNT = 6;

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

/**
 * Shot count the user asked for (「六个分镜」「8 个分镜」「十二镜」), or the
 * default when the request does not name a number.
 */
export function resolveRequestedShotCount(prompt: string | undefined): number {
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
  return DEFAULT_SHOT_COUNT;
}

function outlineText(): string {
  return [
    "This stage produces an outline in beats.",
    "Write one beat per line and keep the order of events. If the user asks for a number of beats (for example four beats), write exactly that many lines: do not merge them into one sentence and do not drop beats. Keep every beat's unresolved tension and do not compress, summarize or skip material that later stages will need; length follows the story, so a long story gets a long outline. Do not add a new ending that the user did not ask for.",
  ].join(" ");
}

function scriptText(): string {
  return [
    "This stage produces script pages, not a caption paragraph.",
    "Start with a scene heading line such as `INT. MARKET STREET - NIGHT` (INT./EXT., location, time). Then write action lines in present tense, one action per paragraph. Then give one or two lines of dialogue in the form `NAME: spoken line` — at least one spoken line is required; when the material has none, invent a short line that fits the scene instead of leaving the script dialogue-free.",
    "Write the whole page in the language of the user's intent and step material; keep scene headings and character cues in that same language except for the INT./EXT. marker.",
    "The caption rule card's single-paragraph shape does not apply to this stage; keep the page structure even when the target model usually takes captions.",
  ].join(" ");
}

function storyboardText(shotCount: number): string {
  return [
    `This stage produces a shot list with exactly ${shotCount} numbered shots (分镜一 … 分镜${shotCount}).`,
    "Split the script into that many shots; do not merge beats to reach a smaller number and do not invent extra story to reach a larger one.",
    "For each shot state the framing, the camera position or movement, and the subject's action in one sentence.",
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
    const requiredShotCount = resolveRequestedShotCount(input.prompt);
    return { stage, requiredShotCount, system: storyboardText(requiredShotCount) };
  }
  const durationSeconds = input.video?.durationSeconds ?? 8;
  const shotCount = input.video?.shotCount ?? 0;
  return { stage, system: unitText(durationSeconds, shotCount) };
}