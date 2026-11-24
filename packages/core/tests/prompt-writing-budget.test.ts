import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DatabaseAdapter,
  PromptVocabDB,
  SCHEMA_INDEXES,
  SCHEMA_TABLES,
} from "@prompthub/db";
import { PromptOrchestrator } from "../src/prompt-orchestrator";
import type { PromptOrchestratorLlm } from "../src/prompt-orchestrator-llm";
import { resolveSystemPromptLayerBudget } from "../src/prompt-writing-budget";

let database: DatabaseAdapter.Database;
let vocabulary: PromptVocabDB;

beforeEach(() => {
  database = new DatabaseAdapter(":memory:");
  database.exec(SCHEMA_TABLES);
  database.exec(SCHEMA_INDEXES);
  vocabulary = new PromptVocabDB(database);
});

afterEach(() => database.close());

function words(count: number): string {
  return Array.from({ length: count }, (_, index) => `word${index % 97}`).join(" ");
}

function llm(): PromptOrchestratorLlm {
  return {
    complete: async () =>
      JSON.stringify({ initialPrompt: "a portrait", completePrompt: "a portrait", fields: [] }),
  };
}

function orchestrator(): PromptOrchestrator {
  return new PromptOrchestrator({ vocabulary, llm: llm() });
}

describe("writing layer budget", () => {
  it("leaves a small layer room inside 8K and accounts for the fixed costs", () => {
    const budget = resolveSystemPromptLayerBudget(
      { skill: "moss", mode: "expand" },
      "Prefer muted palettes and visible material detail.",
      { contextTokens: 8192 },
    );
    expect(budget.contextTokens).toBe(8192);
    expect(budget.outputReserveTokens).toBe(4096);
    expect(budget.contractTokens).toBeGreaterThan(300);
    expect(budget.safetyTokens).toBe(328);
    expect(budget.budgetTokens).toBeGreaterThan(0);
    expect(budget.fits).toBe(true);
    expect(budget.usedTokens).toBe(8);
    expect(budget.budgetTokens + budget.outputReserveTokens +
      budget.contractTokens + budget.inputTokens + budget.vocabularyTokens +
      budget.safetyTokens).toBe(budget.contextTokens);
  });

  it("rejects a full writing guide in 8K and explains the overage", async () => {
    const layer = words(3000);
    const budget = resolveSystemPromptLayerBudget(
      { skill: "moss", mode: "expand" },
      layer,
      { contextTokens: 8192 },
    );
    expect(budget.fits).toBe(false);
    expect(budget.overBy).toBe(3000 - budget.budgetTokens);

    await expect(
      orchestrator().orchestrate({
        prompt: "a portrait",
        skill: "moss",
        outputFormat: "caption",
        systemPromptLayer: layer,
        systemPromptLayerContextSize: 8192,
      }),
    ).rejects.toMatchObject({ code: "SYSTEM_PROMPT_LAYER_OVER_BUDGET" });
  });

  it("accepts the same layer at 32K and reports what was enforced", async () => {
    const layer = words(3000);
    const result = await orchestrator().orchestrate({
      prompt: "a portrait",
      skill: "moss",
      outputFormat: "caption",
      systemPromptLayer: layer,
      systemPromptLayerSource: "MOSS writing core",
      systemPromptLayerPresetId: "builtin-moss-writing-core",
      systemPromptLayerContextSize: 32768,
    });
    expect(result.systemPromptLayerMetrics).toMatchObject({
      tokens: 3000,
      contextTokens: 32768,
      outputReserveTokens: 4096,
      presetId: "builtin-moss-writing-core",
    });
    expect(result.systemPromptLayerMetrics?.budgetTokens).toBeGreaterThan(20_000);
  });

  it("keeps a hard transport cap and validates the declared context", async () => {
    await expect(
      orchestrator().orchestrate({
        prompt: "a portrait",
        skill: "moss",
        systemPromptLayer: "a".repeat(60_001),
      }),
    ).rejects.toThrow(/60,000 characters or fewer/);

    await expect(
      orchestrator().orchestrate({
        prompt: "a portrait",
        skill: "moss",
        systemPromptLayer: "keep it short",
        systemPromptLayerContextSize: 2048,
      }),
    ).rejects.toThrow(/systemPromptLayerContextSize/);

    await expect(
      orchestrator().orchestrate({
        prompt: "a portrait",
        skill: "moss",
        systemPromptLayer: "keep it short",
        systemPromptLayerContextSize: 8192,
        systemPromptLayerOutputReserve: 100,
      }),
    ).rejects.toThrow(/systemPromptLayerOutputReserve/);
  });

  it("counts the vocabulary budget and image placeholders against the same context", () => {
    const text = "Keep the output to one composition.";
    const plain = resolveSystemPromptLayerBudget(
      { skill: "moss", mode: "expand" },
      text,
      { contextTokens: 8192, vocabularyTokenBudget: 0 },
    );
    const withVocabulary = resolveSystemPromptLayerBudget(
      { skill: "moss", mode: "expand" },
      text,
      { contextTokens: 8192, vocabularyTokenBudget: 1200 },
    );
    expect(withVocabulary.budgetTokens).toBe(plain.budgetTokens - 1200);
    expect(withVocabulary.vocabularyTokens).toBe(1200);

    const withImage = resolveSystemPromptLayerBudget(
      {
        skill: "moss",
        mode: "expand",
        imageUrls: ["data:image/png;base64,x"],
      },
      text,
      { contextTokens: 8192, vocabularyTokenBudget: 0 },
    );
    expect(withImage.imageTokens).toBe(1024);
    expect(withImage.budgetTokens).toBe(plain.budgetTokens - 1024);
  });
});
