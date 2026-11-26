import { describe, expect, it } from "vitest";
import { getPromptRuleCard } from "../src/prompt-orchestrator-rule-cards";
import { buildCompositionMessages } from "../src/prompt-orchestrator-composition";

describe("rule card content range", () => {
  it("keeps the K2 card all-ages by default", () => {
    const card = getPromptRuleCard("k2");
    expect(card).toContain("all-ages");
    expect(card).not.toContain("adult");
  });

  it("declares the adult branch only when the user allows it", () => {
    const base = getPromptRuleCard("k2");
    const adult = getPromptRuleCard("k2", { allowAdult: true });
    expect(adult).toContain("adult");
    expect(adult).not.toContain("all-ages");

    const baseLines = base.split("\n");
    const adultLines = adult.split("\n");
    expect(adultLines).toHaveLength(baseLines.length);
    const changed = baseLines.filter((line, index) => line !== adultLines[index]);
    expect(changed).toHaveLength(1);
    expect(changed[0]).toContain("all-ages");
  });

  it("leaves the other rule cards untouched by the content range", () => {
    for (const skill of ["moodyMoss", "moss", "minimaxH3"] as const) {
      expect(getPromptRuleCard(skill, { allowAdult: true })).toBe(getPromptRuleCard(skill));
    }
  });

  it("injects the adult clause into the composition only when it is allowed", () => {
    const base = buildCompositionMessages({ skill: "k2", mode: "expand" }, [], [], []);
    const adult = buildCompositionMessages(
      { skill: "k2", mode: "expand", allowAdult: true },
      [],
      [],
      [],
    );
    expect(base.system).toContain("all-ages");
    expect(base.system).not.toContain("adult");
    expect(adult.system).toContain("adult");
    expect(adult.system).not.toContain("all-ages");
  });

  it("keeps the caption structure rules identical across both content ranges", () => {
    const base = getPromptRuleCard("k2").split("\n");
    const adult = getPromptRuleCard("k2", { allowAdult: true }).split("\n");
    const captionRules = base.filter((line) =>
      line.includes("one coherent paragraph") ||
      line.includes("exactly one visual style") ||
      line.includes("Bind every attribute"),
    );
    expect(captionRules).toHaveLength(3);
    for (const rule of captionRules) {
      expect(adult).toContain(rule);
    }
  });
});
