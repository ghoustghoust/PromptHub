import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseAdapter, PromptVocabDB, SCHEMA_INDEXES, SCHEMA_TABLES } from "@prompthub/db";
import type { PromptMossLayoutDraft } from "@prompthub/shared/types";
import { compileMossLayout, mossLayoutValidationError, serializeMossLayout } from "../src/prompt-moss-layout";
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

function draft(width = 1024, height = 1024): PromptMossLayoutDraft {
  return {
    version: 1,
    canvas: { width, height },
    boxes: [
      {
        id: "background",
        label: "object",
        caption: "A warm cream paper background",
        bbox: [0, 0, 1000, 1000],
      },
      {
        id: "title",
        label: "text",
        caption: "Large dark-blue uppercase title",
        text: "EXPLORE\nNOW",
        bbox: [100, 125, 250, 875],
      },
      {
        id: "traveler",
        label: "object",
        caption: "A small traveler facing the mountains",
        character: true,
        bbox: [500, 400, 850, 650],
      },
    ],
  };
}

describe("MOSS native layout compiler", () => {
  it("compiles normalized boxes to center-origin pixels and preserves exact text", () => {
    const result = compileMossLayout(draft(), "A minimalist travel poster");
    expect(result.modelPrompt.bbox_coord_space).toBe("abs_centralized");
    expect(result.modelPrompt.bbox_format).toBe("yxyx");
    expect(result.modelPrompt.summary.meta).toBeUndefined();
    expect(result.modelPrompt.summary).toEqual({
      canvas: "single",
      caption: "A minimalist travel poster",
    });
    expect(result.modelPrompt.items[0].label).toBe("object");
    expect(result.modelPrompt.items[2].label).toBe("character");
    expect(result.modelPrompt.items[0].bbox).toEqual([-512, -512, 512, 512]);
    expect(result.modelPrompt.items[1].bbox).toEqual([-410, -384, -256, 384]);
    expect(result.modelPrompt.items[1].text).toBe("EXPLORE\nNOW");
    expect(result.characterBoxes).toEqual([3]);
    expect(JSON.parse(serializeMossLayout(result))).toEqual(result.modelPrompt);
  });

  it("rescales the same relative composition for an exact 16:9 canvas", () => {
    const wide = draft(1280, 720);
    wide.boxes = [{
      id: "half",
      label: "object",
      caption: "The upper-left quadrant",
      bbox: [0, 0, 500, 500],
    }];
    const result = compileMossLayout(wide, "A wide poster");
    expect(result.modelPrompt.items[0].bbox).toEqual([-360, -640, 0, 0]);
  });

  it("rejects invalid dimensions, missing text and malformed boxes", () => {
    expect(mossLayoutValidationError(draft(1000, 1000))).toMatch(/multiples of 16/);
    const missingText = draft();
    missingText.boxes[1].text = undefined;
    expect(mossLayoutValidationError(missingText)).toMatch(/text is required/);
    const inverted = draft();
    inverted.boxes[0].bbox = [900, 0, 100, 1000];
    expect(mossLayoutValidationError(inverted)).toMatch(/normalized yxyx/);
  });
});

describe("MOSS canvas orchestration", () => {
  it("lets the LLM refine descriptions while the host owns geometry and text", async () => {
    const layout = draft();
    const llm: PromptOrchestratorLlm = {
      complete: async () => JSON.stringify({
        initialPrompt: "A travel poster",
        completePrompt: "A refined minimalist travel poster with crisp visual hierarchy",
        layoutCaptions: [
          "A subtle warm cream paper texture",
          "Oversized dark-blue geometric title lettering",
          "A tiny lone traveler looking toward distant blue mountains",
        ],
        fields: [],
      }),
    };
    const result = await new PromptOrchestrator({ vocabulary, llm }).orchestrate({
      prompt: "A minimalist travel poster",
      mode: "professional",
      skill: "moss",
      outputFormat: "layout",
      canvas: layout.canvas,
      layout,
    });
    const modelPrompt = JSON.parse(result.completePrompt);
    expect(result.status).toBe("complete");
    expect(modelPrompt.summary.caption).toContain("refined minimalist");
    expect(modelPrompt.items[1].caption).toContain("geometric");
    expect(modelPrompt.items[1].text).toBe("EXPLORE\nNOW");
    expect(modelPrompt.items[1].bbox).toEqual([-410, -384, -256, 384]);
    expect(result.layout?.characterBoxes).toEqual([3]);
    expect(result.warnings.join(" ")).toContain("exactly 1024x1024");
  });

  it("returns a valid marked fallback instead of accepting missing box captions", async () => {
    const llm: PromptOrchestratorLlm = {
      complete: async () => JSON.stringify({
        initialPrompt: "core",
        completePrompt: "invalid incomplete layout",
        fields: [],
      }),
    };
    const result = await new PromptOrchestrator({ vocabulary, llm }).orchestrate({
      prompt: "A minimalist travel poster",
      mode: "expand",
      skill: "moss",
      outputFormat: "layout",
      layout: draft(),
    });
    expect(result.status).toBe("degraded");
    expect(JSON.parse(result.completePrompt).items).toHaveLength(3);
    expect(result.warnings.join(" ")).toContain("deterministic fallback");
  });
});
