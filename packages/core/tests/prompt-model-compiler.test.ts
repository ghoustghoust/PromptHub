import { describe, expect, it } from "vitest";
import type { PromptOrchestrationSkill } from "@prompthub/shared/types";
import { getPromptRuleCard } from "../src/prompt-orchestrator-rule-cards";
import {
  compileModelPrompt,
  compileSharedSemantics,
  type PromptSharedSemantics,
} from "../src/prompt-model-compiler";

const FACTS: PromptSharedSemantics = {
  subject: "a courier waiting under a street lamp",
  action: "shaking rain from a sealed envelope",
  setting: "a narrow street after midnight",
  composition: "medium shot from eye level, subject left of centre",
  lighting: "single warm practical against cool wet asphalt",
  continuity: "same coat and envelope as the previous shot",
};

describe("shared semantics compile once, model rules stay local", () => {
  it("keeps the shared block byte-identical across models", () => {
    const moss = compileModelPrompt(FACTS, "moss");
    const k2 = compileModelPrompt(FACTS, "k2");
    const h3 = compileModelPrompt(FACTS, "minimaxH3", { allowAdult: false });

    expect(moss.shared).toBe(k2.shared);
    expect(k2.shared).toBe(h3.shared);
    expect(moss.modelRules).not.toBe(k2.modelRules);
    expect(k2.modelRules).not.toBe(h3.modelRules);
  });

  it("includes the shared block exactly once in each compiled prompt", () => {
    for (const skill of ["moss", "k2", "minimaxH3", "moodyMoss"] as PromptOrchestrationSkill[]) {
      const compiled = compileModelPrompt(FACTS, skill);
      const occurrences = compiled.text.split(compiled.shared).length - 1;
      expect(occurrences, skill).toBe(1);
      expect(compiled.text).toContain(compiled.modelRules);
    }
  });

  it("uses the existing rule card as the model-specific half", () => {
    const compiled = compileModelPrompt(FACTS, "k2", { allowAdult: true });
    expect(compiled.modelRules).toBe(getPromptRuleCard("k2", { allowAdult: true }));
  });

  it("drops empty fields instead of emitting blank lines", () => {
    const shared = compileSharedSemantics({ subject: "a courier" });
    expect(shared).toContain("a courier");
    expect(shared).not.toMatch(/\n\s*\n\s*\n/);
    expect(shared.split("\n").every((line) => line.trim().length > 0)).toBe(true);
  });

  it("does not duplicate a shared fact inside the model rules", () => {
    const compiled = compileModelPrompt(FACTS, "moss");
    const fact = "single warm practical against cool wet asphalt";
    const sharedCount = compiled.shared.split(fact).length - 1;
    const ruleCount = compiled.modelRules.split(fact).length - 1;
    expect(sharedCount).toBe(1);
    expect(ruleCount).toBe(0);
  });
});