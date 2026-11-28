import { describe, expect, it } from "vitest";
import {
  createScriptFlow,
  currentScriptVersion,
  nextScriptStage,
  normalizeScriptShotCount,
  recordScriptStep,
  scriptFlowShotCount,
  setScriptFlowShotCount,
  staleScriptStages,
  type PromptScriptFlow,
} from "../src/prompt-script-flow";

const at = (day: number) => new Date(Date.UTC(2026, 10, day));

function fillThrough(stages: Array<"outline" | "script" | "storyboard" | "unit">): PromptScriptFlow {
  let flow = createScriptFlow();
  stages.forEach((stage, index) => {
    flow = recordScriptStep(flow, { stage, text: `${stage} text`, now: at(index + 1) }).flow;
  });
  return flow;
}

describe("script flow", () => {
  it("advances in order and starts every stage at version 1", () => {
    let flow = createScriptFlow();
    const stages = ["outline", "script", "storyboard", "unit"] as const;
    stages.forEach((stage, index) => {
      const result = recordScriptStep(flow, { stage, text: `${stage} v1`, now: at(index + 1) });
      expect(result.version.version).toBe(1);
      flow = result.flow;
    });
    expect(currentScriptVersion(flow, "unit")?.text).toBe("unit v1");
    expect(nextScriptStage(flow)).toBeNull();
    expect(staleScriptStages(flow)).toEqual([]);
  });

  it("rejects skipping a stage instead of inventing missing facts", () => {
    let flow = createScriptFlow();
    expect(() =>
      recordScriptStep(flow, { stage: "script", text: "script without outline" }),
    ).toThrow("Cannot start script before outline exists");
    flow = recordScriptStep(flow, { stage: "outline", text: "outline" }).flow;
    expect(() =>
      recordScriptStep(flow, { stage: "storyboard", text: "skip script" }),
    ).toThrow("Cannot start storyboard before script exists");
  });

  it("appends a version on revision and keeps the earlier text", () => {
    let flow = fillThrough(["outline", "script"]);
    const revised = recordScriptStep(flow, { stage: "outline", text: "outline v2", now: at(9) });
    flow = revised.flow;
    expect(revised.version.version).toBe(2);
    expect(flow.versions.outline.map((item) => item.text)).toEqual(["outline text", "outline v2"]);
    expect(currentScriptVersion(flow, "outline")?.text).toBe("outline v2");
    expect(currentScriptVersion(flow, "script")?.basedOn).toEqual({ outline: 1 });
  });

  it("marks downstream stages stale when upstream is revised", () => {
    let flow = fillThrough(["outline", "script", "storyboard"]);
    expect(staleScriptStages(flow)).toEqual([]);
    flow = recordScriptStep(flow, { stage: "outline", text: "outline v2", now: at(9) }).flow;
    expect(staleScriptStages(flow)).toEqual(["script"]);
    expect(nextScriptStage(flow)).toBe("script");

    flow = recordScriptStep(flow, { stage: "script", text: "script v2", now: at(10) }).flow;
    expect(staleScriptStages(flow)).toEqual(["storyboard"]);
  });

  it("rejects empty text and unknown stages", () => {
    const flow = createScriptFlow();
    expect(() => recordScriptStep(flow, { stage: "outline", text: "   " })).toThrow(
      "needs non-empty text",
    );
    expect(() =>
      recordScriptStep(flow, { stage: "trailer" as never, text: "x" }),
    ).toThrow("Unknown script stage");
  });

  it("returns a new flow and leaves the input untouched", () => {
    const flow = createScriptFlow();
    const result = recordScriptStep(flow, { stage: "outline", text: "outline" });
    expect(flow.versions.outline).toHaveLength(0);
    expect(result.flow.versions.outline).toHaveLength(1);
    expect(result.flow).not.toBe(flow);
  });
});

describe("script flow settings", () => {
  it("defaults the scene shot count and keeps a usable setting", () => {
    expect(scriptFlowShotCount(null)).toBe(6);
    expect(scriptFlowShotCount(createScriptFlow())).toBe(6);
    const flow = setScriptFlowShotCount(createScriptFlow(), 9);
    expect(scriptFlowShotCount(flow)).toBe(9);
    expect(flow.settings).toEqual({ shotCount: 9 });
  });

  it("falls back to the default instead of storing an unusable count", () => {
    expect(normalizeScriptShotCount(0)).toBe(6);
    expect(normalizeScriptShotCount(99)).toBe(6);
    expect(normalizeScriptShotCount(4.5)).toBe(6);
    expect(normalizeScriptShotCount("9")).toBe(6);
    expect(normalizeScriptShotCount(1)).toBe(1);
    expect(normalizeScriptShotCount(60)).toBe(60);
  });

  it("keeps the shot count when a stage version is appended", () => {
    const withSetting = setScriptFlowShotCount(createScriptFlow(), 8);
    const result = recordScriptStep(withSetting, { stage: "outline", text: "outline" });
    expect(scriptFlowShotCount(result.flow)).toBe(8);
    // The input flow is not mutated by the caller's setting either.
    expect(withSetting.versions.outline).toHaveLength(0);
  });

  it("does not disturb the version chains when the count changes", () => {
    const filled = fillThrough(["outline", "script"]);
    const updated = setScriptFlowShotCount(filled, 12);
    expect(updated.versions).toEqual(filled.versions);
    expect(filled.settings).toBeUndefined();
  });
});