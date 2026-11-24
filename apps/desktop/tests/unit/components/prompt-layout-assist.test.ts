import { describe, expect, it } from "vitest";
import type { PromptMossLayoutBox } from "@prompthub/shared/types";
import { applyCaptionsToBoxes } from "../../../src/renderer/components/prompt/prompt-layout-assist";

function box(id: string, caption = "", label: PromptMossLayoutBox["label"] = "object"): PromptMossLayoutBox {
  return {
    id,
    label,
    caption,
    bbox: [100, 100, 300, 300],
    ...(label === "text" ? { text: "TEXT" } : {}),
  };
}

describe("applyCaptionsToBoxes", () => {
  it("keeps captions attached to the requested box ids after a reorder", () => {
    const requestedIds = ["a", "b", "c"];
    const current = [box("c"), box("a"), box("b")];
    const next = applyCaptionsToBoxes(current, requestedIds, ["A", "B", "C"]);
    expect(next.map((entry) => [entry.id, entry.caption])).toEqual([
      ["c", "C"],
      ["a", "A"],
      ["b", "B"],
    ]);
  });

  it("skips boxes deleted during the request and leaves new boxes untouched", () => {
    const requestedIds = ["a", "b"];
    const current = [box("b"), box("new")];
    const next = applyCaptionsToBoxes(current, requestedIds, ["A", "B"]);
    expect(next.find((entry) => entry.id === "b")?.caption).toBe("B");
    expect(next.find((entry) => entry.id === "new")?.caption).toBe("");
    expect(next.some((entry) => entry.id === "a")).toBe(false);
  });

  it("does not erase an existing caption with an empty response slot", () => {
    const next = applyCaptionsToBoxes([box("a", "kept")], ["a"], ["   "]);
    expect(next[0].caption).toBe("kept");
  });

  it("returns the same array when nothing changes", () => {
    const current = [box("a", "kept")];
    expect(applyCaptionsToBoxes(current, ["a"], ["kept"])).toBe(current);
  });
});