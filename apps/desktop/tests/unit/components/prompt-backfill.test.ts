import { describe, expect, it } from "vitest";
import type { PromptProvenanceEntry } from "@prompthub/shared/types";
import {
  backfillStateFor,
  mergeBackfillTerms,
  shouldBackfillProvenance,
} from "../../../src/renderer/components/prompt/prompt-backfill";
import type { PrefabTerm } from "../../../src/renderer/components/prompt/usePromptOrchestratorWorkbench";

function term(id: string, state: PrefabTerm["state"] = "recommended"): PrefabTerm {
  return {
    id,
    category: "lighting",
    subcategory: null,
    en: id,
    zh: null,
    series: null,
    template: null,
    validationStatus: "unvalidated",
    state,
  };
}

function entry(overrides: Partial<PromptProvenanceEntry> = {}): PromptProvenanceEntry {
  return {
    id: "term:light-1",
    kind: "term",
    label: "soft light",
    state: "auto",
    outcome: "verbatim",
    excerpt: "soft light",
    origin: "policy",
    termId: "light-1",
    ...overrides,
  };
}

describe("result backfill into the picker", () => {
  it("adds new result terms without duplicating existing ones", () => {
    const merged = mergeBackfillTerms(
      [term("light-1", "recommended"), term("light-2", "locked")],
      [term("light-1", "locked"), term("light-3", "reference")],
    );
    expect(merged.map((item) => item.id)).toEqual(["light-1", "light-2", "light-3"]);
    expect(merged.find((item) => item.id === "light-1")?.state).toBe("locked");
    expect(merged.find((item) => item.id === "light-3")?.state).toBe("reference");
  });

  it("never overrides a user lock or exclusion with a result state", () => {
    const merged = mergeBackfillTerms(
      [term("light-1", "locked"), term("light-2", "excluded")],
      [term("light-1", "recommended"), term("light-2", "recommended")],
    );
    expect(merged.find((item) => item.id === "light-1")?.state).toBe("locked");
    expect(merged.find((item) => item.id === "light-2")?.state).toBe("excluded");
  });

  it("maps provenance states to picker states", () => {
    expect(backfillStateFor(entry({ state: "locked" }))).toBe("locked");
    expect(backfillStateFor(entry({ state: "reference" }))).toBe("reference");
    expect(backfillStateFor(entry({ state: "excluded", outcome: "absent" }))).toBe("excluded");
    expect(backfillStateFor(entry({ state: "auto" }))).toBe("recommended");
    expect(backfillStateFor(entry({ state: "resolved" }))).toBe("recommended");
    expect(backfillStateFor(undefined)).toBe("recommended");
  });

  it("skips automatic rows the model never used but keeps explicit ones", () => {
    expect(shouldBackfillProvenance(entry({ outcome: "absent", state: "auto" }))).toBe(false);
    expect(shouldBackfillProvenance(entry({ outcome: "absent", state: "locked" }))).toBe(true);
    expect(shouldBackfillProvenance(entry({ outcome: "absent", state: "recommended" }))).toBe(true);
    expect(shouldBackfillProvenance(entry({ outcome: "absent", state: "excluded" }))).toBe(true);
    expect(shouldBackfillProvenance(entry({ outcome: "fixed" }))).toBe(true);
    expect(shouldBackfillProvenance(entry({ termId: undefined }))).toBe(false);
  });
});