import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseAdapter, PromptVocabDB, SCHEMA_INDEXES, SCHEMA_TABLES } from "@prompthub/db";
import type { PromptReferenceStyleInput } from "@prompthub/shared/types";
import { PromptOrchestrator } from "../src/prompt-orchestrator";
import type { PromptOrchestratorLlm } from "../src/prompt-orchestrator-llm";
import {
  buildCompositionMessages,
  buildWritingLayerText,
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

function reference(overrides: Partial<PromptReferenceStyleInput> = {}): PromptReferenceStyleInput {
  return {
    id: "ref-1",
    nameZh: "大卫·芬奇",
    nameEn: "David Fincher",
    category: "黑色悬疑与冷调惊悚",
    summary: "暗绿黄色调下的病态冷调美学。",
    palette: ["#1A2E2A", "#A89C3E"],
    style: { lighting: "侧逆光", framing: "对称固定机位" },
    ...overrides,
  };
}

function llm(sink: { system?: string; user?: string } = {}): PromptOrchestratorLlm {
  return {
    complete: async (request) => {
      sink.system = request.messages.system;
      sink.user = request.messages.user;
      return JSON.stringify({ initialPrompt: "a duel", completePrompt: "a duel", fields: [] });
    },
  };
}

describe("reference color cards in Core", () => {
  it("injects name, summary, palette and light outside the writing layer", () => {
    const messages = buildCompositionMessages(
      { skill: "moss", mode: "expand", referenceStyles: [reference()] },
      [],
      [],
      [],
    );
    expect(messages.system).toContain("大卫·芬奇 / David Fincher");
    expect(messages.system).toContain("暗绿黄色调下的病态冷调美学");
    expect(messages.system).toContain("#1A2E2A");
    expect(messages.system).toContain("侧逆光");
    expect(messages.system).toContain("对称固定机位");

    const writingLayer = buildWritingLayerText({
      skill: "moss",
      mode: "expand",
      referenceStyles: [reference()],
    });
    expect(writingLayer).toBe("");
  });

  it("reserves reference tokens separately from the writing-layer budget", () => {
    const without = resolveSystemPromptLayerBudget({ skill: "moss", mode: "expand" }, "");
    const withReference = resolveSystemPromptLayerBudget(
      { skill: "moss", mode: "expand", referenceStyles: [reference()] },
      "",
    );
    expect(withReference.referenceTokens).toBeGreaterThan(10);
    expect(without.referenceTokens).toBe(0);
    expect(withReference.budgetTokens).toBe(without.budgetTokens - withReference.referenceTokens);
    expect(
      withReference.budgetTokens +
      withReference.outputReserveTokens +
      withReference.contractTokens +
      withReference.inputTokens +
      withReference.vocabularyTokens +
      withReference.imageTokens +
      withReference.safetyTokens +
      withReference.referenceTokens,
    ).toBe(withReference.contextTokens);
  });

  it("records injected references in provenance", async () => {
    const result = await new PromptOrchestrator({ vocabulary, llm: llm() }).orchestrate({
      prompt: "a duel",
      skill: "moss",
      mode: "expand",
      outputFormat: "caption",
      referenceStyles: [reference()],
    });
    const entries = result.provenance?.filter((entry) => entry.kind === "reference") ?? [];
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: "reference:ref-1",
      label: "大卫·芬奇",
      outcome: "injected",
      origin: "user",
    });
    expect(result.systemPromptLayerMetrics?.referenceTokens).toBeGreaterThan(10);
  });

  it("keeps reference provenance in the deterministic fallback", async () => {
    const failing: PromptOrchestratorLlm = {
      complete: async () => {
        throw new Error("engine stopped");
      },
    };
    const result = await new PromptOrchestrator({ vocabulary, llm: failing }).orchestrate({
      prompt: "a duel",
      skill: "moss",
      mode: "expand",
      outputFormat: "caption",
      referenceStyles: [reference()],
    });
    expect(result.provenance?.some((entry) => entry.kind === "reference")).toBe(true);
  });

  it("rejects more than three references", async () => {
    await expect(
      new PromptOrchestrator({ vocabulary, llm: llm() }).orchestrate({
        prompt: "a duel",
        skill: "moss",
        mode: "expand",
        outputFormat: "caption",
        referenceStyles: [
          reference({ id: "1" }),
          reference({ id: "2" }),
          reference({ id: "3" }),
          reference({ id: "4" }),
        ],
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});