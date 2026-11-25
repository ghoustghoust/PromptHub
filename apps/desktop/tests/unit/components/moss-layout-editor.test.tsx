import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useMossLayoutEditor } from "../../../src/renderer/components/prompt/useMossLayoutEditor";

function size(bbox: readonly number[]): { width: number; height: number } {
  return { width: bbox[3] - bbox[1], height: bbox[2] - bbox[0] };
}

describe("useMossLayoutEditor", () => {
  it("starts with an empty canvas and no selection", () => {
    const { result } = renderHook(() => useMossLayoutEditor());
    expect(result.current.boxes).toEqual([]);
    expect(result.current.selectedBoxId).toBeNull();
    expect(result.current.complete).toBe(false);
  });

  it("offsets repeated boxes so new clicks do not stack on top of each other", () => {
    const { result } = renderHook(() => useMossLayoutEditor());
    act(() => {
      result.current.addBox("object");
      result.current.addBox("object");
      result.current.addBox("object");
    });

    const boxes = result.current.boxes;
    expect(boxes).toHaveLength(3);
    expect(new Set(boxes.map((box) => box.bbox.join(","))).size).toBe(3);
    for (const box of boxes) {
      expect(box.bbox[0]).toBeGreaterThanOrEqual(0);
      expect(box.bbox[1]).toBeGreaterThanOrEqual(0);
      expect(box.bbox[2]).toBeLessThanOrEqual(1000);
      expect(box.bbox[3]).toBeLessThanOrEqual(1000);
      expect(size(box.bbox)).toEqual({ width: 400, height: 400 });
    }
  });

  it("keeps the background full canvas", () => {
    const { result } = renderHook(() => useMossLayoutEditor());
    act(() => {
      result.current.addBox("background");
      result.current.addBox("background");
    });
    expect(result.current.boxes.map((box) => box.bbox)).toEqual([
      [0, 0, 1000, 1000],
      [0, 0, 1000, 1000],
    ]);
  });

  it("clears every box and the selection", () => {
    const { result } = renderHook(() => useMossLayoutEditor());
    act(() => {
      result.current.addBox("object");
      result.current.addBox("text");
    });
    expect(result.current.boxes).toHaveLength(2);
    expect(result.current.selectedBoxId).not.toBeNull();

    act(() => result.current.clearBoxes());
    expect(result.current.boxes).toEqual([]);
    expect(result.current.selectedBoxId).toBeNull();
    expect(result.current.selectedBox).toBeNull();
    expect(result.current.complete).toBe(false);
  });
});
