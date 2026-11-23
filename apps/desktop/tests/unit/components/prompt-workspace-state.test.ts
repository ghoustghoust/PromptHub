import { describe, expect, it } from "vitest";
import { normalizeWorkspaceTerms } from "../../../src/renderer/components/prompt/prompt-workspace-state";

const valid = {
  id: "light-1",
  category: "lighting",
  subcategory: null,
  en: "soft light",
  zh: "柔光",
  series: null,
  template: null,
  validationStatus: "validated",
  state: "locked",
};

describe("workspace state normalization", () => {
  it("keeps valid rows and defaults unknown enums", () => {
    const terms = normalizeWorkspaceTerms([
      valid,
      { ...valid, id: "light-2", state: "mystery", validationStatus: "mystery" },
    ]);
    expect(terms).toHaveLength(2);
    expect(terms[1].state).toBe("recommended");
    expect(terms[1].validationStatus).toBe("unvalidated");
  });

  it("skips malformed and duplicate rows", () => {
    const terms = normalizeWorkspaceTerms([
      valid,
      valid,
      { ...valid, id: "" },
      { ...valid, id: "no-en", en: "  " },
      null,
      "text",
    ]);
    expect(terms.map((term) => term.id)).toEqual(["light-1"]);
  });

  it("returns an empty list for non-array input", () => {
    expect(normalizeWorkspaceTerms(null)).toEqual([]);
    expect(normalizeWorkspaceTerms({ prefabTerms: [valid] })).toEqual([]);
  });
});