import { useMemo, useState } from "react";
import type {
  PromptMossLayoutBox,
  PromptMossLayoutDraft,
  PromptMossLayoutLabel,
} from "@prompthub/shared/types";
import {
  mossResolution,
  MOSS_ASPECT_RATIOS,
  MOSS_DEFAULT_MEGAPIXELS,
  MOSS_MEGAPIXEL_OPTIONS,
} from "./prompt-orchestrator-catalog";

export type MossLayoutPreset = "background" | PromptMossLayoutLabel;

/** Finds the preset pair that produces exactly the restored canvas size. */
function matchPreset(width: number, height: number): { ratio: string; megapixels: string } | null {
  for (const ratio of MOSS_ASPECT_RATIOS) {
    for (const megapixels of MOSS_MEGAPIXEL_OPTIONS) {
      const size = mossResolution(ratio.label, Number(megapixels));
      if (size?.width === width && size.height === height) {
        return { ratio: ratio.label, megapixels };
      }
    }
  }
  return null;
}

/**
 * Steps a new box down-right by a fixed amount so repeated clicks stay
 * visible instead of stacking exactly on top of each other.
 */
function cascadeBBox(
  bbox: [number, number, number, number],
  existingCount: number,
): [number, number, number, number] {
  const step = 24;
  const shift = (existingCount % 8) * step;
  const height = bbox[2] - bbox[0];
  const width = bbox[3] - bbox[1];
  const top = Math.min(bbox[0] + shift, 1000 - height);
  const left = Math.min(bbox[1] + shift, 1000 - width);
  return [top, left, top + height, left + width];
}

function newBox(
  id: string,
  kind: MossLayoutPreset,
  existingCount: number,
): PromptMossLayoutBox {
  const label = kind === "text" ? "text" : "object";
  // A background always covers the whole canvas; offsetting it would leave gaps.
  const base: [number, number, number, number] = kind === "background"
    ? [0, 0, 1000, 1000]
    : kind === "text"
      ? [100, 100, 300, 900]
      : [300, 300, 700, 700];
  return {
    id,
    label,
    caption: "",
    ...(label === "text" ? { text: "" } : {}),
    bbox: kind === "background" ? base : cascadeBBox(base, existingCount),
  };
}

export function useMossLayoutEditor() {
  const [width, setWidthState] = useState("1024");
  const [height, setHeightState] = useState("1024");
  const [ratio, setRatioState] = useState("1:1");
  const [megapixels, setMegapixelsState] = useState(MOSS_DEFAULT_MEGAPIXELS);
  const [boxes, setBoxes] = useState<PromptMossLayoutBox[]>([]);
  const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null);

  const selectedBox = useMemo(
    () => boxes.find((box) => box.id === selectedBoxId) ?? null,
    [boxes, selectedBoxId],
  );

  /** Applies the exact ComfyUI ResolutionSelector size for a ratio/megapixel pair. */
  function applyResolution(nextRatio: string, nextMegapixels: string): void {
    const size = mossResolution(nextRatio, Number(nextMegapixels));
    if (!size) return;
    setRatioState(nextRatio);
    setWidthState(String(size.width));
    setHeightState(String(size.height));
  }

  function setRatio(next: string): void {
    applyResolution(next, megapixels);
  }

  function setMegapixels(next: string): void {
    setMegapixelsState(next);
    applyResolution(ratio, next);
  }

  // Manual pixel edits fall back to a custom canvas instead of a stale preset.
  function setWidth(next: string): void {
    setWidthState(next);
    setRatioState("custom");
  }

  function setHeight(next: string): void {
    setHeightState(next);
    setRatioState("custom");
  }

  function addBox(kind: MossLayoutPreset): void {
    const id = crypto.randomUUID();
    setBoxes((current) => [...current, newBox(id, kind, current.length)]);
    setSelectedBoxId(id);
  }

  /** Removes every box; used by the canvas "clear" action after confirmation. */
  function clearBoxes(): void {
    setBoxes([]);
    setSelectedBoxId(null);
  }

  function updateBox(id: string, patch: Partial<PromptMossLayoutBox>): void {
    setBoxes((current) => current.map((box) => box.id === id ? { ...box, ...patch } : box));
  }

  function removeBox(id: string): void {
    const index = boxes.findIndex((box) => box.id === id);
    const next = boxes.filter((box) => box.id !== id);
    setBoxes(next);
    if (selectedBoxId === id) {
      setSelectedBoxId(next[Math.min(index, next.length - 1)]?.id ?? null);
    }
  }

  function moveBox(id: string, direction: -1 | 1): void {
    setBoxes((current) => {
      const index = current.findIndex((box) => box.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  /** Restores a persisted draft; the ratio and megapixel chips follow the size when they still match. */
  function restore(draft: PromptMossLayoutDraft): void {
    setWidthState(String(draft.canvas.width));
    setHeightState(String(draft.canvas.height));
    setBoxes(draft.boxes);
    setSelectedBoxId(draft.boxes[0]?.id ?? null);
    const preset = matchPreset(draft.canvas.width, draft.canvas.height);
    setRatioState(preset?.ratio ?? "custom");
    if (preset) setMegapixelsState(preset.megapixels);
  }

  // Captions may stay empty: the orchestrator fills them before compiling.
  const complete = boxes.length > 0 && boxes.every((box) =>
    box.label !== "text" || Boolean(box.text?.trim()),
  );

  return {
    width, setWidth, height, setHeight,
    ratio, setRatio, megapixels, setMegapixels,
    boxes, setBoxes, selectedBoxId, setSelectedBoxId, selectedBox,
    addBox, updateBox, removeBox, moveBox, restore, clearBoxes, complete,
  };
}
