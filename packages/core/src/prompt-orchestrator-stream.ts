import type { PromptOrchestratorStreamEvent } from "@prompthub/shared/types";
import type { PromptLlmStreamCallbacks } from "./prompt-orchestrator-llm";

/** Top-level keys the composition JSON is expected to contain, in order. */
const STRUCTURE_KEYS = [
  "initialPrompt",
  "completePrompt",
  "fields",
  "payload",
  "layoutCaptions",
] as const;

export type PromptStreamEmitter = (event: PromptOrchestratorStreamEvent) => void;

/**
 * Streams deltas and reports which top-level JSON keys have appeared. This is a
 * structure checklist, not a completion percentage: the model may skip optional
 * keys, so the UI must present it as "fields seen" rather than progress truth.
 */
export function createStreamCallbacks(
  emit: PromptStreamEmitter | undefined,
): PromptLlmStreamCallbacks | undefined {
  if (!emit) return undefined;
  let text = "";
  let reported = 0;
  return {
    onDelta: (delta) => {
      text += delta;
      emit({ type: "delta", text: delta });
      const seen = STRUCTURE_KEYS.filter((key) => text.includes(`"${key}"`));
      if (seen.length !== reported) {
        reported = seen.length;
        emit({
          type: "structure",
          fields: [...seen],
          percent: Math.round((seen.length / STRUCTURE_KEYS.length) * 100),
        });
      }
    },
    onMode: (mode) => {
      emit({ type: "stats", mode, source: "estimate" });
    },
    onStats: (stats) => {
      emit({ type: "stats", ...stats });
    },
  };
}
