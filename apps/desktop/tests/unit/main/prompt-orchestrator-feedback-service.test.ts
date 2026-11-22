import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SCHEMA_TABLES } from "@prompthub/db";
import type { PromptOrchestrationResult } from "@prompthub/shared/types";
import { DesktopPromptOrchestratorService } from "../../../src/main/services/prompt-orchestrator-service";
import DatabaseAdapter from "../../../src/main/database/sqlite";

let rawDb: DatabaseAdapter.Database;

function result(overrides: Partial<PromptOrchestrationResult> = {}): PromptOrchestrationResult {
  return {
    mode: "expand",
    skill: "moss",
    outputFormat: "caption",
    media: "image",
    initialPrompt: "a quiet portrait",
    completePrompt: "a quiet portrait in soft light",
    fields: [],
    selectedTerms: [],
    modelDirectives: [],
    warnings: [],
    tokenMetrics: {
      initialPromptTokens: 4,
      completePromptTokens: 7,
      vocabularyEstimatedTokens: 0,
      method: "estimate",
    },
    status: "complete",
    guidanceMode: "agent-led",
    termDecisions: [
      {
        slotId: "lighting",
        category: "lighting",
        sourceText: "soft light",
        strategy: "create",
        terms: [],
        output: "soft light",
        rationale: "no candidate",
        origin: "model",
      },
    ],
    provenance: [
      {
        id: "term:light-1",
        kind: "term",
        label: "soft light",
        state: "auto",
        outcome: "absent",
        excerpt: "",
        origin: "policy",
      },
    ],
    ...overrides,
  };
}

function request(value: unknown = result()): unknown {
  return {
    input: { prompt: "a quiet portrait", mode: "expand", skill: "moss" },
    result: value,
    feedback: { rating: "usable", reasons: ["style-off"], note: "slightly warm" },
  };
}

beforeEach(() => {
  rawDb = new DatabaseAdapter(":memory:");
  rawDb.pragma("foreign_keys = ON");
  rawDb.exec(SCHEMA_TABLES);
});

afterEach(() => rawDb.close());

describe("orchestrator feedback service", () => {
  it("validates the IPC payload and stores a snapshot without images", () => {
    const service = new DesktopPromptOrchestratorService(rawDb);
    const record = service.submitFeedback(request());
    expect(record).toMatchObject({
      mode: "expand",
      skill: "moss",
      rating: "usable",
      reasons: ["style-off"],
      note: "slightly warm",
    });
    const row = rawDb
      .prepare(
        "SELECT snapshot_json FROM prompt_orchestration_feedback WHERE id = ?",
      )
      .get(record.id) as { snapshot_json: string };
    const snapshot = JSON.parse(row.snapshot_json) as Record<string, unknown>;
    expect(snapshot).toMatchObject({
      mode: "expand",
      completePrompt: "a quiet portrait in soft light",
      guidanceMode: "agent-led",
    });
    expect(snapshot.termDecisions).toHaveLength(1);
    expect(snapshot.provenance).toHaveLength(1);
    expect(snapshot.imageUrls).toBeUndefined();
    expect(snapshot.layout).toBeUndefined();
  });

  it("rejects missing feedback, bad ratings and empty result prompts", () => {
    const service = new DesktopPromptOrchestratorService(rawDb);
    expect(() => service.submitFeedback({})).toThrow("input, result and feedback");
    expect(() =>
      service.submitFeedback({
        input: { prompt: "x" },
        result: result(),
        feedback: { rating: "great", reasons: [] },
      }),
    ).toThrow("usable or unusable");
    expect(() =>
      service.submitFeedback(request(result({ completePrompt: "  " }))),
    ).toThrow("non-empty result prompt");
  });

  it("derives the prompt excerpt from random-mode constraints", () => {
    const service = new DesktopPromptOrchestratorService(rawDb);
    const record = service.submitFeedback({
      input: {
        mode: "random",
        skill: "moss",
        random: { subject: "a courier", setting: "a rainy station" },
      },
      result: result({ mode: "random" }),
      feedback: { rating: "unusable", reasons: ["intent-drift"] },
    });
    expect(record.promptExcerpt).toBe("a courier / a rainy station");
  });
});