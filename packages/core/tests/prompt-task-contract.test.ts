import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DatabaseAdapter,
  PromptVocabDB,
  SCHEMA_INDEXES,
  SCHEMA_TABLES,
} from "@prompthub/db";
import type { PromptOrchestrationInput } from "@prompthub/shared/types";
import {
  applyPromptTaskContract,
  resolvePromptTaskContract,
} from "@prompthub/shared/utils/prompt-task-contract";
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

function composition(completePrompt: string): string {
  return JSON.stringify({ initialPrompt: "core", completePrompt, fields: [] });
}

function baseInput(overrides: Partial<PromptOrchestrationInput> = {}): PromptOrchestrationInput {
  return {
    prompt: "A reader by a tall window",
    mode: "expand",
    skill: "moss",
    outputFormat: "caption",
    ...overrides,
  };
}

describe("prompt task contract", () => {
  it("classifies an agent-led image expansion and its default resource rights", () => {
    const contract = resolvePromptTaskContract(baseInput());
    expect(contract.taskKind).toBe("expand");
    expect(contract.media).toBe("image");
    expect(contract.writing).toBe("creative");
    expect(contract.resources.knowledge).toMatchObject({
      allowed: true,
      source: "explicit",
    });
    expect(contract.resources.reference).toMatchObject({
      allowed: true,
      source: "explicit",
    });
    expect(contract.resources.vocabulary).toMatchObject({
      allowed: true,
      source: "automatic",
    });
    expect(contract.resources.vocabularyRetrieval.allowed).toBe(true);
    expect(contract.resources.layout.allowed).toBe(false);
    expect(contract.resources.images.allowed).toBe(false);
    expect(contract.resources.assets).toMatchObject({
      allowed: false,
      source: "unavailable",
      reason: "resource-not-consumed",
    });
    expect(contract.retrieval).toMatchObject({
      automatic: true,
      modelTools: true,
      maxRounds: 4,
      maxToolCalls: 6,
      allowExploratory: true,
    });
  });

  it("keeps human-led runs free of automatic retrieval while explicit resources stay usable", () => {
    const contract = resolvePromptTaskContract(
      baseInput({ guidanceMode: "human-led" }),
    );
    expect(contract.resources.vocabulary.allowed).toBe(false);
    expect(contract.resources.vocabularyRetrieval.allowed).toBe(false);
    expect(contract.resources.knowledge.allowed).toBe(true);
    expect(contract.resources.reference.allowed).toBe(true);
    expect(contract.retrieval).toMatchObject({
      automatic: false,
      modelTools: false,
      allowExploratory: false,
    });
    expect(contract.reasons).toContain("human-led-no-automatic-retrieval");
  });

  it("treats a reverse run with images as a single vision pass", () => {
    const contract = resolvePromptTaskContract(
      baseInput({ mode: "reverse", imageUrls: ["data:image/png;base64,x"] }),
    );
    expect(contract.resources.images.allowed).toBe(true);
    expect(contract.resources.vocabularyRetrieval.allowed).toBe(false);
    expect(contract.retrieval.modelTools).toBe(false);
    expect(contract.reasons).toContain("reverse-with-images-single-shot");
  });

  it("lets the layout output own the layout resource and compile deterministically", () => {
    const contract = resolvePromptTaskContract(
      baseInput({ outputFormat: "layout" }),
    );
    expect(contract.resources.layout.allowed).toBe(true);
    expect(contract.writing).toBe("dispatch");
    expect(contract.resources.vocabularyRetrieval.allowed).toBe(false);
    expect(contract.reasons).toContain("layout-deterministic-compile");
  });

  it("keeps knowledge and color cards available to a video task but not layout", () => {
    const contract = resolvePromptTaskContract(
      baseInput({ mode: "video-text", skill: "minimaxH3", outputFormat: "h3" }),
    );
    expect(contract.media).toBe("video");
    expect(contract.taskKind).toBe("video-text");
    expect(contract.resources.video.allowed).toBe(true);
    expect(contract.resources.knowledge.allowed).toBe(true);
    expect(contract.resources.reference.allowed).toBe(true);
    expect(contract.resources.layout.allowed).toBe(false);
    expect(contract.reasons).toContain("video-single-pass");
  });

  it("drops resources the current task does not consume and reports each rejection", () => {
    const input = baseInput({
      video: { durationSeconds: 12, shotCount: 2 },
      layout: {
        version: 1,
        canvas: { width: 1024, height: 1024 },
        boxes: [],
      },
    });
    const applied = applyPromptTaskContract(input);
    expect(applied.contract.rejectedResources).toEqual(
      expect.arrayContaining([
        { resource: "video", reason: "video-ignored-for-image-task" },
        { resource: "layout", reason: "layout-ignored-for-non-layout-task" },
      ]),
    );
    expect(applied.input.video).toBeUndefined();
    expect(applied.input.layout).toBeUndefined();
    // The caller's object must not be mutated.
    expect(input.video).toBeDefined();
    expect(input.layout).toBeDefined();
  });

  it("keeps the aspect-ratio canvas on a video task and drops a layout draft", () => {
    const applied = applyPromptTaskContract(
      baseInput({
        mode: "video-frames",
        skill: "minimaxH3",
        outputFormat: "h3",
        canvas: { width: 1280, height: 720 },
        layout: {
          version: 1,
          canvas: { width: 1280, height: 720 },
          boxes: [],
        },
      }),
    );
    expect(applied.input.canvas).toEqual({ width: 1280, height: 720 });
    expect(applied.input.layout).toBeUndefined();
    expect(applied.contract.rejectedResources).toContainEqual({
      resource: "layout",
      reason: "layout-ignored-for-video-task",
    });
  });

  it("publishes one resource whitelist row per task", () => {
    const rows: Array<{
      label: string;
      input: Partial<PromptOrchestrationInput>;
      expect: Record<string, boolean>;
    }> = [
      { label: "expand", input: { mode: "expand" }, expect: { vocabulary: true, vocabularyRetrieval: true, images: false, layout: false, video: false } },
      { label: "polish", input: { mode: "polish" }, expect: { vocabulary: true, vocabularyRetrieval: true, layout: false } },
      { label: "reverse-text", input: { mode: "reverse" }, expect: { vocabularyRetrieval: true, images: true, layout: false } },
      { label: "reverse-image", input: { mode: "reverse", imageUrls: ["data:image/png;base64,x"] }, expect: { vocabularyRetrieval: false, images: true } },
      { label: "video", input: { mode: "video-text", skill: "minimaxH3", outputFormat: "h3" }, expect: { video: true, layout: false, vocabularyRetrieval: false, images: false } },
      { label: "layout", input: { mode: "expand", outputFormat: "layout" }, expect: { layout: true, vocabularyRetrieval: false } },
      { label: "random", input: { mode: "random" }, expect: { vocabularyRetrieval: false, layout: false } },
    ];
    for (const row of rows) {
      const contract = resolvePromptTaskContract(baseInput(row.input));
      for (const [resource, allowed] of Object.entries(row.expect)) {
        expect(
          contract.resources[resource as keyof typeof contract.resources].allowed,
          `${row.label} -> ${resource}`,
        ).toBe(allowed);
      }
    }
  });

  it("produces a stable signature that changes with the contract, not the prompt body", () => {
    const left = resolvePromptTaskContract(baseInput({ prompt: "one scene" }));
    const right = resolvePromptTaskContract(baseInput({ prompt: "another scene" }));
    const human = resolvePromptTaskContract(baseInput({ guidanceMode: "human-led" }));
    expect(left.signature).toBe(right.signature);
    expect(left.signature).not.toBe(human.signature);
  });
});

describe("task contract inside orchestration", () => {
  it("removes video-only input from an image run before validation and reports it", async () => {
    let user = "";
    const llm: PromptOrchestratorLlm = {
      complete: async (request) => {
        user = request.messages.user;
        return composition("A reader by a tall window in cold morning light");
      },
    };
    const result = await new PromptOrchestrator({ vocabulary, llm }).orchestrate(
      baseInput({
        // Out-of-range values: if the contract did not drop this first,
        // validateInput would reject the whole request.
        video: { durationSeconds: 9999 },
      }),
    );
    expect(result.taskContract?.media).toBe("image");
    expect(result.taskContract?.rejectedResources).toContainEqual({
      resource: "video",
      reason: "video-ignored-for-image-task",
    });
    expect(JSON.parse(user).video).toBeFalsy();
    expect(
      result.warnings.some((warning) => /video/i.test(warning)),
    ).toBe(true);
  });

  it("publishes the video contract on a real H3 run", async () => {
    const llm: PromptOrchestratorLlm = {
      complete: async () =>
        composition(
          "integrated_multimodal_description: [Shot 1] A cook lifts noodles in steam.",
        ),
    };
    const result = await new PromptOrchestrator({ vocabulary, llm }).orchestrate(
      baseInput({
        mode: "video-text",
        skill: "minimaxH3",
        outputFormat: "h3",
        video: { durationSeconds: 12, shotCount: 1 },
      }),
    );
    expect(result.taskContract).toBeDefined();
    expect(result.taskContract?.media).toBe("video");
    expect(result.taskContract?.resources.layout.allowed).toBe(false);
    expect(result.taskContract?.retrieval.modelTools).toBe(false);
  });
});