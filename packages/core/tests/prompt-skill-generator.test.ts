import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DatabaseAdapter,
  PromptVocabDB,
  SCHEMA_INDEXES,
  SCHEMA_TABLES,
} from "@prompthub/db";
import { parseSkillMd } from "../src/skills/skill-frontmatter";
import { getPromptRuleCard } from "../src/prompt-orchestrator-rule-cards";
import { PromptSkillGenerator } from "../src/prompt-skill-generator";
import type { PromptOrchestratorLlm } from "../src/prompt-orchestrator-llm";

let database: DatabaseAdapter.Database;
let vocabulary: PromptVocabDB;

beforeEach(() => {
  database = new DatabaseAdapter(":memory:");
  database.exec(SCHEMA_TABLES);
  database.exec(SCHEMA_INDEXES);
  vocabulary = new PromptVocabDB(database);
  vocabulary.addTerm({
    id: "test-golden-hour",
    category: "lighting",
    en: "golden hour",
    template: "warm low-angle sunlight with soft amber highlights",
    validationStatus: "validated",
    createdAt: "2026-11-18T00:00:00.000Z",
  });
});

afterEach(() => {
  database.close();
});

function llmReturning(content: string): PromptOrchestratorLlm {
  return { complete: async () => content };
}

describe("PromptSkillGenerator", () => {
  it("writes exact references and creative suggestions into a reusable SKILL.md", async () => {
    const generator = new PromptSkillGenerator({
      vocabulary,
      llm: llmReturning(JSON.stringify({
        name: "Golden Hour Skill",
        description: "Create coherent golden-hour scenes.",
        workflow: [{ step: { description: "Preserve fixed user facts." } }, "Use vocabulary only when relevant."],
        suggestions: [{
          title: "Dust motes",
          content: "Add subtle dust motes in side light.",
          rationale: "Adds depth without changing the subject.",
        }],
      })),
    });
    const draft = await generator.generate({
      prompt: "A reader beside a wooden window at golden hour",
      mode: "expand",
      skill: "moss",
      categories: ["lighting"],
    });

    expect(draft.status).toBe("complete");
    expect(draft.name).toBe("golden-hour-skill");
    expect(draft.content).toContain(getPromptRuleCard("moss"));
    expect(draft.content).toContain("warm low-angle sunlight with soft amber highlights");
    expect(draft.content).toContain("[REFERENCE]");
    expect(draft.content).toContain("[SUGGESTION] Dust motes");
    expect(draft.suggestions).toHaveLength(1);
    expect(parseSkillMd(draft.content)?.frontmatter.name).toBe("golden-hour-skill");
    expect(draft.references.some((item) =>
      item.kind === "vocabulary" && item.validationStatus === "validated"
    )).toBe(true);
  });

  it("keeps exact references and reports degraded output when the LLM fails", async () => {
    const generator = new PromptSkillGenerator({
      vocabulary,
      llm: { complete: async () => { throw new Error("offline"); } },
    });
    const draft = await generator.generate({
      prompt: "A reader beside a wooden window at golden hour",
      skill: "k2",
      categories: ["lighting"],
    });

    expect(draft.status).toBe("degraded");
    expect(draft.content).toContain(getPromptRuleCard("k2"));
    expect(draft.content).toContain("[REFERENCE]");
    expect(draft.suggestions).toEqual([]);
    expect(draft.warnings.join(" ")).toContain("offline");
  });

  it("honors an explicit normalized skill name", async () => {
    const generator = new PromptSkillGenerator({
      vocabulary,
      llm: llmReturning(JSON.stringify({
        description: "A reusable lighting guide.",
        workflow: ["Start from the user's intent."],
        suggestions: [{ title: "Backlight", content: "Try restrained rim light." }],
      })),
    });
    const draft = await generator.generate(
      { prompt: "Golden hour portrait", categories: ["lighting"] },
      "My Custom Skill",
    );

    expect(draft.name).toBe("my-custom-skill");
    expect(parseSkillMd(draft.content)?.frontmatter.name).toBe("my-custom-skill");
  });
});
