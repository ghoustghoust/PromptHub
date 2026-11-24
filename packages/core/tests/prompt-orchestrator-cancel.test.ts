import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseAdapter, PromptVocabDB, SCHEMA_INDEXES, SCHEMA_TABLES } from "@prompthub/db";
import { PromptOrchestrator } from "../src/prompt-orchestrator";
import type { PromptOrchestratorLlm } from "../src/prompt-orchestrator-llm";

let database: DatabaseAdapter.Database;
let vocabulary: PromptVocabDB;

beforeEach(() => {
  database = new DatabaseAdapter(":memory:");
  database.exec(SCHEMA_TABLES);
  database.exec(SCHEMA_INDEXES);
  vocabulary = new PromptVocabDB(database);
});

afterEach(() => database.close());

describe("orchestration cancellation", () => {
  it("does not call the model when the run is already cancelled", async () => {
    const complete = vi.fn(async () => "{}");
    const llm: PromptOrchestratorLlm = { complete };
    const controller = new AbortController();
    controller.abort();
    const orchestrator = new PromptOrchestrator({
      vocabulary,
      llm,
      signal: controller.signal,
    });
    await expect(
      orchestrator.orchestrate({ prompt: "a portrait", skill: "moss", outputFormat: "caption" }),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(complete).not.toHaveBeenCalled();
  });

  it("reports cancellation instead of degrading to a deterministic fallback", async () => {
    const controller = new AbortController();
    const llm: PromptOrchestratorLlm = {
      complete: async () => {
        controller.abort();
        throw new Error("The operation was aborted");
      },
    };
    const orchestrator = new PromptOrchestrator({
      vocabulary,
      llm,
      signal: controller.signal,
    });
    await expect(
      orchestrator.orchestrate({ prompt: "a portrait", skill: "moss", outputFormat: "caption" }),
    ).rejects.toMatchObject({ code: "CANCELLED" });
  });

  it("refuses layout refinement when the run is already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const orchestrator = new PromptOrchestrator({
      vocabulary,
      llm: { complete: async () => "" },
      signal: controller.signal,
    });
    await expect(
      orchestrator.refineLayoutCaptions({
        draft: { version: 1, canvas: { width: 1024, height: 1024 }, boxes: [] },
      }),
    ).rejects.toMatchObject({ code: "CANCELLED" });
  });
});
