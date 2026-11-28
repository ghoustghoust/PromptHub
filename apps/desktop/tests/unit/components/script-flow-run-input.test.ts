import { describe, expect, it } from "vitest";
import { createScriptFlow, createUnitMaterials } from "@prompthub/core/prompt-script-flow";
import { scriptFlowRunFields } from "../../../src/renderer/components/prompt/script-flow-run-input";

const flow = createScriptFlow();

describe("scriptFlowRunFields", () => {
  it("keeps a plain run plain", () => {
    expect(
      scriptFlowRunFields({ flow: null, stepContext: "  ", stage: "outline", shotCount: 6, materials: createUnitMaterials("text") }),
    ).toEqual({});
  });

  it("sends the stage for a flow run", () => {
    expect(
      scriptFlowRunFields({ flow, stepContext: "", stage: "storyboard", shotCount: 8, materials: createUnitMaterials("text") }),
    ).toEqual({ stage: "storyboard", shotCount: 8 });
  });

  it("sends step material without a stored flow", () => {
    expect(
      scriptFlowRunFields({ flow: null, stepContext: "outline text", stage: "script", shotCount: 6, materials: createUnitMaterials("text") }),
    ).toEqual({ stepContext: "outline text", stage: "script", shotCount: 6 });
  });

  it("only declares materials for a unit that needs them", () => {
    expect(
      scriptFlowRunFields({ flow, stepContext: "", stage: "unit", shotCount: 6, materials: createUnitMaterials("text") }),
    ).not.toHaveProperty("unitMaterials");
    const materials = createUnitMaterials("first-frame");
    expect(
      scriptFlowRunFields({ flow, stepContext: "", stage: "unit", shotCount: 6, materials }),
    ).toEqual({ stage: "unit", shotCount: 6, unitMaterials: materials });
  });

  it("does not attach materials to an earlier stage", () => {
    expect(
      scriptFlowRunFields({ flow, stepContext: "", stage: "script", shotCount: 6, materials: createUnitMaterials("first-frame") }),
    ).not.toHaveProperty("unitMaterials");
  });
});