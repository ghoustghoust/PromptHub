import { describe, expect, it } from "vitest";
import {
  createScriptFlow,
  createUnitMaterials,
  normalizeUnitMaterials,
  recordScriptStep,
  scriptFlowMaterials,
  setScriptFlowMaterials,
  type PromptScriptFlow,
} from "../src/prompt-script-flow";

const at = new Date(Date.UTC(2026, 10, 28));

function fillThroughOutline(): PromptScriptFlow {
  return recordScriptStep(createScriptFlow(), { stage: "outline", text: "outline", now: at }).flow;
}

describe("unit material slots", () => {
  it("asks for no file when the unit is text only", () => {
    const materials = createUnitMaterials("text");
    expect(materials.mode).toBe("text");
    expect(materials.slots).toEqual([]);
  });

  it("gives the frame modes one slot per required frame", () => {
    expect(createUnitMaterials("first-frame").slots.map((slot) => slot.kind)).toEqual([
      "first-frame",
    ]);
    expect(createUnitMaterials("first-last").slots.map((slot) => slot.kind)).toEqual([
      "first-frame",
      "last-frame",
    ]);
  });

  it("numbers reference slots and clamps the count", () => {
    const materials = createUnitMaterials("references", 3);
    expect(materials.referenceCount).toBe(3);
    expect(materials.slots.map((slot) => slot.index)).toEqual([1, 2, 3]);
    expect(createUnitMaterials("references", 0).referenceCount).toBe(1);
    expect(createUnitMaterials("references", 99).referenceCount).toBe(9);
  });

  it("treats a slot without a stored file as missing", () => {
    const materials = createUnitMaterials("first-last");
    expect(materials.slots.every((slot) => slot.fileName === undefined)).toBe(true);
  });
});

describe("normalizeUnitMaterials", () => {
  it("falls back to text only for unknown modes", () => {
    expect(normalizeUnitMaterials(null)?.mode).toBe("text");
    expect(normalizeUnitMaterials({ mode: "trailer" })?.mode).toBe("text");
  });

  it("drops slot files that are paths instead of stored file names", () => {
    const materials = normalizeUnitMaterials({
      mode: "first-frame",
      slots: [
        { kind: "first-frame", fileName: "C:\\frames\\a.png" },
        { kind: "first-frame", fileName: "../a.png" },
        { kind: "first-frame", fileName: "a.png", label: "a.png" },
        { kind: "trailer", fileName: "b.png" },
      ],
    });
    expect(materials?.slots).toHaveLength(1);
    expect(materials?.slots[0].fileName).toBe("a.png");
  });

  it("keeps reference slots bounded and ignores extra slots", () => {
    const slots = Array.from({ length: 12 }, (_, index) => ({
      kind: "reference",
      index: index + 1,
      fileName: `${index + 1}.png`,
    }));
    const materials = normalizeUnitMaterials({ mode: "references", referenceCount: 99, slots });
    expect(materials?.referenceCount).toBe(9);
    expect(materials?.slots).toHaveLength(9);
  });
});

describe("materials on the flow", () => {
  it("defaults to text only when nothing is stored", () => {
    expect(scriptFlowMaterials(null).mode).toBe("text");
    expect(scriptFlowMaterials(createScriptFlow()).mode).toBe("text");
  });

  it("keeps the setting without touching versions", () => {
    const flow = fillThroughOutline();
    const updated = setScriptFlowMaterials(flow, createUnitMaterials("first-last"));
    expect(scriptFlowMaterials(updated).mode).toBe("first-last");
    expect(updated.versions).toEqual(flow.versions);
    expect(flow.settings?.materials).toBeUndefined();
  });

  it("snapshots the materials on a unit version", () => {
    let flow = fillThroughOutline();
    flow = recordScriptStep(flow, { stage: "script", text: "script", now: at }).flow;
    flow = recordScriptStep(flow, { stage: "storyboard", text: "storyboard", now: at }).flow;
    flow = setScriptFlowMaterials(flow, createUnitMaterials("first-frame"));
    const result = recordScriptStep(flow, { stage: "unit", text: "unit", now: at });
    expect(result.version.materials?.mode).toBe("first-frame");
    expect(result.version.materials?.slots[0].kind).toBe("first-frame");
  });

  it("does not attach materials to earlier stages", () => {
    const flow = setScriptFlowMaterials(fillThroughOutline(), createUnitMaterials("first-frame"));
    const result = recordScriptStep(flow, { stage: "outline", text: "outline v2", now: at });
    expect(result.version.materials).toBeUndefined();
  });
});