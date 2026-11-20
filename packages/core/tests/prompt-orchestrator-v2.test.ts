import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DatabaseAdapter,
  PromptVocabDB,
  SCHEMA_INDEXES,
  SCHEMA_TABLES,
} from "@prompthub/db";
import { PromptOrchestrator } from "../src/prompt-orchestrator";
import type { PromptOrchestratorLlm } from "../src/prompt-orchestrator-llm";
import { OpenAiCompatiblePromptLlm } from "../src/prompt-orchestrator-llm";

let database: DatabaseAdapter.Database;
let vocabulary: PromptVocabDB;

beforeEach(() => {
  database = new DatabaseAdapter(":memory:");
  database.exec(SCHEMA_TABLES);
  database.exec(SCHEMA_INDEXES);
  vocabulary = new PromptVocabDB(database);
  for (const [id, en] of [["light-a", "golden hour"], ["light-b", "soft rim light"]]) {
    vocabulary.addTerm({
      id,
      category: "lighting",
      en,
      validationStatus: "validated",
      createdAt: "2026-11-18T00:00:00.000Z",
    });
  }
});

afterEach(() => database.close());

function composition(completePrompt: string) {
  return JSON.stringify({ initialPrompt: "core", completePrompt, fields: [] });
}

describe("PromptOrchestrator v2 contracts", () => {
  it("does not cap MOSS output at the old 2048-token default", async () => {
    let maxTokens = 0;
    const llm = new OpenAiCompatiblePromptLlm(
      { endpoint: "http://127.0.0.1:8080/v1", model: "prompthub-local" },
      async (request) => {
        maxTokens = JSON.parse(request.body ?? "{}").max_tokens;
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          body: JSON.stringify({ choices: [{ message: { content: "{}" } }] }),
          headers: {},
        };
      },
    );
    await llm.complete({
      messages: { system: "system", user: "user" },
      mode: "expand",
    });
    expect(maxTokens).toBe(4096);
  });

  it("keeps human-led explicit vocabulary and disables automatic additions", async () => {
    let system = "";
    const llm: PromptOrchestratorLlm = {
      complete: async (request) => {
        system = request.messages.system;
        return composition("A restrained polished scene");
      },
    };
    const result = await new PromptOrchestrator({ vocabulary, llm }).orchestrate({
      prompt: "A reader by a window",
      mode: "polish",
      skill: "moss",
      outputFormat: "caption",
      guidanceMode: "human-led",
      selectedTermIds: ["light-a"],
      lockedTermIds: ["light-a"],
      categories: ["lighting"],
    });
    expect(result.selectedTerms.map((term) => term.id)).toEqual(["light-a"]);
    expect(system).toContain("Human-led mode");
  });

  it("accepts a PromptHub layout draft for the moodyMoss rule card", async () => {
    const llm: PromptOrchestratorLlm = {
      complete: async () =>
        JSON.stringify({
          initialPrompt: "poster",
          completePrompt: "A poster with one centred headline",
          fields: [],
          layoutCaptions: ["A bold centred headline"],
        }),
    };
    const result = await new PromptOrchestrator({ vocabulary, llm }).orchestrate({
      prompt: "A poster with one centred headline",
      mode: "expand",
      skill: "moodyMoss",
      outputFormat: "layout",
      guidanceMode: "human-led",
      canvas: { width: 1024, height: 1024 },
      layout: {
        version: 1,
        canvas: { width: 1024, height: 1024 },
        boxes: [
          {
            id: "headline",
            label: "text",
            caption: "A bold headline",
            text: "HELLO",
            bbox: [100, 100, 300, 900],
          },
        ],
      },
    });
    expect(result.layout?.modelPrompt.bbox_coord_space).toBe("abs_centralized");
    expect(result.completePrompt).toContain("\"bbox_format\":\"yxyx\"");
    expect(result.completePrompt).toContain("HELLO");
  });

  it("produces MiniMax-H3 video output and local-tokenizer metrics", async () => {
    const llm: PromptOrchestratorLlm = {
      complete: async () => composition(
        "integrated_multimodal_description: [Shot 1] A cook lifts noodles.\n\noverall_soundscape: Water boils.\n\nnon_diegetic_music: N/A",
      ),
      countTokens: async (text) => text.length,
    };
    const result = await new PromptOrchestrator({ vocabulary, llm }).orchestrate({
      prompt: "A street cook lifts noodles at night",
      mode: "video-text",
      skill: "minimaxH3",
      outputFormat: "h3",
      video: { durationSeconds: 6, shotCount: 1, audio: "Water boils" },
    });
    expect(result.media).toBe("video");
    expect(result.completePrompt).toContain("integrated_multimodal_description");
    expect(result.tokenMetrics.method).toBe("llm-tokenizer");
  });

  it("rejects plain prose masquerading as H3 and returns a marked valid fallback", async () => {
    const llm: PromptOrchestratorLlm = {
      complete: async () => composition("A cook lifts noodles"),
    };
    const result = await new PromptOrchestrator({ vocabulary, llm }).orchestrate({
      prompt: "A street cook lifts noodles",
      mode: "video-text",
      skill: "minimaxH3",
      outputFormat: "h3",
    });
    expect(result.status).toBe("degraded");
    expect(result.completePrompt).toContain("integrated_multimodal_description:");
    expect(result.completePrompt).toContain("overall_soundscape:");
    expect(result.completePrompt).toContain("non_diegetic_music:");
  });

  it("treats MOSS length as a soft token warning rather than padding", async () => {
    const llm: PromptOrchestratorLlm = {
      complete: async () => composition("short but complete"),
      countTokens: async () => 2600,
    };
    const result = await new PromptOrchestrator({ vocabulary, llm }).orchestrate({
      prompt: "A girl sits at a desk watching the window",
      mode: "expand",
      skill: "moss",
      outputFormat: "caption",
    });
    expect(result.completePrompt).toBe("short but complete");
    expect(result.warnings.join(" ")).toContain("2500-token reference plateau");
    expect(result.warnings.join(" ")).toContain("do not truncate");
  });

  it("supports JSON payload as an output option and rejects H3 for image tasks", async () => {
    const llm: PromptOrchestratorLlm = {
      complete: async () => JSON.stringify({
        initialPrompt: "core",
        completePrompt: "complete",
        fields: [],
        payload: { prompt: "complete" },
      }),
    };
    const orchestrator = new PromptOrchestrator({ vocabulary, llm });
    const result = await orchestrator.orchestrate({
      prompt: "A reader",
      includePayload: true,
    });
    expect(result.payload).toEqual({ prompt: "complete" });
    await expect(orchestrator.orchestrate({
      prompt: "A reader",
      skill: "minimaxH3",
      outputFormat: "h3",
    })).rejects.toThrow(/only available for video/);
  });
});
