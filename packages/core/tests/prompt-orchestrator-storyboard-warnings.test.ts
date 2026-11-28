import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseAdapter, PromptVocabDB, SCHEMA_TABLES } from "@prompthub/db";
import { PromptOrchestrator } from "../src/prompt-orchestrator";
import type { PromptOrchestratorLlm } from "../src/prompt-orchestrator-llm";

let database: DatabaseAdapter.Database;
let vocabulary: PromptVocabDB;

beforeEach(() => {
  database = new DatabaseAdapter(":memory:");
  database.exec(SCHEMA_TABLES);
  vocabulary = new PromptVocabDB(database);
});

afterEach(() => database.close());

function shot(index: number, fields = 6): string {
  const cells = Array.from({ length: fields - 1 }, (_, column) => `c${column}`);
  return `分镜${index} | ${cells.join(" | ")}`;
}

function storyboard(count: number, fields = 6): string {
  return Array.from({ length: count }, (_, index) => shot(index + 1, fields)).join("\n");
}

function orchestratorReturning(prompt: string): PromptOrchestrator {
  const llm: PromptOrchestratorLlm = {
    complete: async () =>
      JSON.stringify({ initialPrompt: "board", completePrompt: prompt, fields: [] }),
  };
  return new PromptOrchestrator({ vocabulary, llm });
}

const input = {
  prompt: "把这场戏拆成三个分镜",
  mode: "expand" as const,
  skill: "k2" as const,
  outputFormat: "caption" as const,
  guidanceMode: "human-led" as const,
  stage: "storyboard" as const,
  shotCount: 3,
};

describe("storyboard warnings", () => {
  it("reports a short shot list without rewriting the text", async () => {
    const produced = storyboard(2);
    const result = await orchestratorReturning(produced).orchestrate(input);
    const warnings = result.warnings.join(" ");
    expect(warnings).toContain("2 shot lines");
    expect(warnings).toContain("3 shots");
    expect(result.completePrompt).toBe(produced);
  });

  it("stays quiet when the storyboard matches the configured shots", async () => {
    const result = await orchestratorReturning(storyboard(3)).orchestrate(input);
    expect(result.warnings.join(" ")).not.toMatch(/shot lines/);
  });

  it("reports a line that lost a column", async () => {
    const produced = `${shot(1)}\n${shot(2, 5)}\n${shot(3)}`;
    const result = await orchestratorReturning(produced).orchestrate(input);
    expect(result.warnings.join(" ")).toContain("5 fields");
    expect(result.completePrompt).toBe(produced);
  });

  it("does not inspect storyboards outside the storyboard stage", async () => {
    const result = await orchestratorReturning(storyboard(2)).orchestrate({
      ...input,
      stage: "script",
    });
    expect(result.warnings.join(" ")).not.toMatch(/shot lines/);
  });
});