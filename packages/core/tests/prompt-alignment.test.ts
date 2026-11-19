import { describe, expect, it } from "vitest";
import { buildPromptAlignment } from "../src/prompt-alignment";

describe("buildPromptAlignment", () => {
  it("pairs a rewritten sentence with its source sentence", () => {
    const alignment = buildPromptAlignment(
      "一个女孩坐在窗边。窗外下着雨。",
      "一位少女坐在木窗旁，雨点敲打窗棂。",
    );
    expect(alignment.method).toBe("sentence-match");
    expect(alignment.leftSegments).toHaveLength(2);
    expect(alignment.rightSegments).toHaveLength(1);
    expect(alignment.rows.some((row) => row.isNew)).toBe(false);
  });

  it("marks sentences the assistant added as new", () => {
    const alignment = buildPromptAlignment(
      "雨夜东京街头。",
      "雨夜东京街头，霓虹倒映在积水里。远处有电车驶过，空气潮湿。",
    );
    const newRows = alignment.rows.filter((row) => row.isNew);
    expect(newRows.length).toBeGreaterThan(0);
    expect(newRows.every((row) => row.leftId === null)).toBe(true);
  });

  it("falls back to no pairing when one side is empty", () => {
    const alignment = buildPromptAlignment("", "只有结果。");
    expect(alignment.method).toBe("none");
    expect(alignment.rows).toHaveLength(0);
    expect(alignment.rightSegments).toHaveLength(1);
  });
});
