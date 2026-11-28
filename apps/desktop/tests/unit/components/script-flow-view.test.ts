import { describe, expect, it } from "vitest";
import { createScriptFlow, recordScriptStep } from "@prompthub/core/prompt-script-flow";
import { canSaveStage, scriptStageStatus, stageVersions } from "../../../src/renderer/components/prompt/script-flow-view";

function filled(through: number) {
  let flow = createScriptFlow();
  const stages = ["outline", "script", "storyboard", "unit"] as const;
  for (let index = 0; index <= through; index += 1) {
    flow = recordScriptStep(flow, {
      stage: stages[index],
      text: `${stages[index]} text`,
      now: new Date(Date.UTC(2026, 10, index + 1)),
    }).flow;
  }
  return flow;
}

describe("script flow view", () => {
  it("marks stages empty, current and done", () => {
    const flow = filled(0);
    expect(scriptStageStatus(flow, "outline")).toBe("done");
    expect(scriptStageStatus(flow, "script")).toBe("next");
    expect(scriptStageStatus(flow, "storyboard")).toBe("empty");
    expect(scriptStageStatus(flow, "unit")).toBe("empty");
  });

  it("allows saving a stage only when its upstream exists or it has history", () => {
    const flow = filled(0);
    expect(canSaveStage(flow, "outline")).toBe(true);
    expect(canSaveStage(flow, "script")).toBe(true);
    expect(canSaveStage(flow, "storyboard")).toBe(false);
    expect(canSaveStage(flow, "unit")).toBe(false);
  });

  it("lists versions newest first with their numbers", () => {
    let flow = filled(0);
    flow = recordScriptStep(flow, { stage: "outline", text: "outline v2" }).flow;
    expect(stageVersions(flow, "outline")).toEqual([
      { version: 2, text: "outline v2" },
      { version: 1, text: "outline text" },
    ]);
    expect(stageVersions(flow, "unit")).toEqual([]);
  });

  it("marks a stage stale when upstream moved on", () => {
    let flow = filled(1);
    expect(scriptStageStatus(flow, "script")).toBe("done");
    flow = recordScriptStep(flow, { stage: "outline", text: "outline v2" }).flow;
    expect(scriptStageStatus(flow, "outline")).toBe("done");
    expect(scriptStageStatus(flow, "script")).toBe("stale");
  });
});