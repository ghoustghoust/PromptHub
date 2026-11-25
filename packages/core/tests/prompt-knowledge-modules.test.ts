import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseAdapter, PromptVocabDB, SCHEMA_INDEXES, SCHEMA_TABLES } from "@prompthub/db";
import type { PromptKnowledgeModuleSelection } from "@prompthub/shared/types";
import { PromptOrchestrator } from "../src/prompt-orchestrator";
import type { PromptLlmCompletionRequest, PromptOrchestratorLlm } from "../src/prompt-orchestrator-llm";
import {
  buildWritingLayerText,
  buildCompositionMessages,
} from "../src/prompt-orchestrator-composition";
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

function module(overrides: Partial<PromptKnowledgeModuleSelection> = {}): PromptKnowledgeModuleSelection {
  return {
    id: "module-1",
    moduleKey: "action-choreography",
    title: "Action choreography",
    packName: "Skill-Film",
    layer: "P",
    content: "Break every fight into spatial beats and camera moves.",
    ...overrides,
  };
}

function capturingLlm(sink: { system?: string; user?: string }): PromptOrchestratorLlm {
  return {
    complete: async (request: PromptLlmCompletionRequest) => {
      sink.system = request.messages.system;
      sink.user = request.messages.user;
      return JSON.stringify({ initialPrompt: "a duel", completePrompt: "a duel", fields: [] });
    },
  };
}

function orchestrator(llm: PromptOrchestratorLlm): PromptOrchestrator {
  return new PromptOrchestrator({ vocabulary, llm });
}

describe("knowledge modules in the writing layer", () => {
  it("joins the user layer and selected modules into one budgeted text", () => {
    const text = buildWritingLayerText({
      skill: "moss",
      mode: "expand",
      systemPromptLayer: "Prefer muted palettes.",
      knowledgeModules: [
        module(),
        module({ id: "module-2", moduleKey: "rhythm", title: "Short-drama rhythm", layer: "S", content: "Cut on the beat." }),
      ],
    });

    expect(text.indexOf("Prefer muted palettes.")).toBeLessThan(
      text.indexOf("Action choreography"),
    );
    expect(text).toContain("Skill-Film");
    expect(text).toContain("Break every fight into spatial beats");
    expect(text).toContain("Cut on the beat.");
  });

  it("counts module content against the same layer budget", () => {
    const input = {
      skill: "moss" as const,
      mode: "expand" as const,
      knowledgeModules: [module({ content: Array.from({ length: 3000 }, (_, index) => `word${index}`).join(" ") })],
    };
    const withoutModules = resolveSystemPromptLayerBudget(input, buildWritingLayerText({
      skill: "moss",
      mode: "expand",
    }));
    const withModules = resolveSystemPromptLayerBudget(input, buildWritingLayerText(input));
    expect(withModules.usedTokens).toBeGreaterThan(withoutModules.usedTokens + 2500);
    expect(withModules.fits).toBe(false);
  });

  it("puts the module text in the system message with an apply-not-quote instruction", () => {
    const messages = buildCompositionMessages(
      { skill: "moss", mode: "expand", knowledgeModules: [module()] },
      [],
      [],
      [],
    );
    expect(messages.system).toContain("Action choreography");
    expect(messages.system).toContain("Break every fight into spatial beats");
    expect(messages.system).toMatch(/knowledge module/i);
  });

  it("rejects an over-budget module set instead of truncating it", async () => {
    const huge = module({
      content: Array.from({ length: 3000 }, (_, index) => `word${index}`).join(" "),
    });
    await expect(
      orchestrator(capturingLlm({})).orchestrate({
        prompt: "a duel",
        skill: "moss",
        mode: "expand",
        outputFormat: "caption",
        knowledgeModules: [huge],
      }),
    ).rejects.toMatchObject({ code: "SYSTEM_PROMPT_LAYER_OVER_BUDGET" });
  });

  it("rejects duplicate module ids and empty content", async () => {
    await expect(
      orchestrator(capturingLlm({})).orchestrate({
        prompt: "a duel",
        skill: "moss",
        mode: "expand",
        outputFormat: "caption",
        knowledgeModules: [module(), module()],
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });

    await expect(
      orchestrator(capturingLlm({})).orchestrate({
        prompt: "a duel",
        skill: "moss",
        mode: "expand",
        outputFormat: "caption",
        knowledgeModules: [module({ content: "   " })],
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("records each injected module in provenance and layer metrics", async () => {
    const sink: { system?: string } = {};
    const result = await orchestrator(capturingLlm(sink)).orchestrate({
      prompt: "a duel",
      skill: "moss",
      mode: "expand",
      outputFormat: "caption",
      knowledgeModules: [
        module(),
        module({ id: "module-2", moduleKey: "rhythm", title: "Short-drama rhythm", content: "Cut on the beat." }),
      ],
    });

    expect(sink.system).toContain("Break every fight into spatial beats");
    const entries = result.provenance?.filter((entry) => entry.kind === "module") ?? [];
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      id: "module:module-1",
      kind: "module",
      label: "Action choreography",
      outcome: "injected",
      origin: "user",
    });
    expect(result.systemPromptLayerMetrics?.tokens).toBeGreaterThan(20);
  });
});