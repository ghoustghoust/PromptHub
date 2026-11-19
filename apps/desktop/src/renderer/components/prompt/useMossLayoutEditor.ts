import { useMemo, useState } from "react";
import type {
  PromptMossLayoutBox,
  PromptMossLayoutLabel,
} from "@prompthub/shared/types";
import { mossResolution, MOSS_DEFAULT_MEGAPIXELS } from "./prompt-orchestrator-catalog";

export type MossLayoutPreset = "background" | PromptMossLayoutLabel;

function newBox(kind: MossLayoutPreset): PromptMossLayoutBox {
  const label = kind === "text" ? "text" : "object";
  return {
    id: crypto.randomUUID(),
    label,
    caption: "",
    ...(label === "text" ? { text: "" } : {}),
    bbox: kind === "background"
      ? [0, 0, 1000, 1000]
      : kind === "text"
        ? [100, 100, 300, 900]
        : [300, 300, 700, 700],
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
    const box = newBox(kind);
    setBoxes((current) => [...current, box]);
    setSelectedBoxId(box.id);
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

  // Captions may stay empty: the orchestrator fills them before compiling.
  const complete = boxes.length > 0 && boxes.every((box) =>
    box.label !== "text" || Boolean(box.text?.trim()),
  );

  return {
    width, setWidth, height, setHeight,
    ratio, setRatio, megapixels, setMegapixels,
    boxes, setBoxes, selectedBoxId, setSelectedBoxId, selectedBox,
    addBox, updateBox, removeBox, moveBox, complete,
  };
}
