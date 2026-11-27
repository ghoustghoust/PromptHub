import { describe, expect, it } from "vitest";
import { parseTermDecisions } from "../src/prompt-term-decisions";

const available = new Map();

function answer(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    initialPrompt: "core",
    completePrompt: "a reader by a window",
    fields: [],
    ...extra,
  });
}

describe("term decision parsing", () => {
  it("treats an omitted termDecisions field as zero decisions", () => {
    const parsed = parseTermDecisions(answer(), available, "Tool retrieval");
    expect(parsed.decisions).toEqual([]);
    expect(parsed.usedTerms).toEqual([]);
    expect(parsed.warnings).toEqual([]);
  });

  it("treats an explicit null as zero decisions", () => {
    const parsed = parseTermDecisions(
      answer({ termDecisions: null }),
      available,
      "Tool retrieval",
    );
    expect(parsed.decisions).toEqual([]);
  });

  it("still rejects a non-array termDecisions value", () => {
    expect(() =>
      parseTermDecisions(answer({ termDecisions: "none" }), available, "Tool retrieval"),
    ).toThrow("requires 0 to 32 termDecisions");
  });

  it("still rejects more than 32 decisions", () => {
    const many = Array.from({ length: 33 }, (_, index) => ({
      slotId: `slot-${index}`,
      category: "lighting",
      sourceText: "light",
      strategy: "create",
      termIds: [],
      output: "light",
    }));
    expect(() =>
      parseTermDecisions(answer({ termDecisions: many }), available, "Tool retrieval"),
    ).toThrow("requires 0 to 32 termDecisions");
  });
});