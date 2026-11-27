import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DatabaseAdapter,
  PromptVocabDB,
  SCHEMA_INDEXES,
  SCHEMA_TABLES,
} from "@prompthub/db";
import type { PromptOrchestrationInput } from "@prompthub/shared/types";
import { PromptOrchestrator } from "../src/prompt-orchestrator";
import type { PromptOrchestratorLlm } from "../src/prompt-orchestrator-llm";

let database: DatabaseAdapter.Database;
let vocabulary: PromptVocabDB;

beforeEach(() => {
  database = new DatabaseAdapter(":memory:");
  database.exec(SCHEMA_TABLES);
  database.exec(SCHEMA_INDEXES);
  vocabulary = new PromptVocabDB(database);
  for (const [id, category, en] of [
    ["light-a", "lighting", "golden hour"],
    ["light-b", "lighting", "soft rim light"],
    ["cam-a", "camera", "85mm lens"],
  ]) {
    vocabulary.addTerm({
      id,
      category,
      en,
      validationStatus: "validated",
      createdAt: "2026-11-26T00:00:00.000Z",
    });
  }
  vocabulary.addModelProfile({
    id: "moss-local",
    name: "MOSS local",
    kind: "base",
    triggerWords: ["moss fidelity"],
  });
});

afterEach(() => database.close());

function composition(completePrompt: string, fields: unknown[] = []): string {
  return JSON.stringify({ initialPrompt: "core", completePrompt, fields });
}

function textLlm(prompt: string, fields: unknown[] = []): PromptOrchestratorLlm {
  return { complete: async () => composition(prompt, fields) };
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

describe("run evidence separates observation from model claims", () => {
  it("counts model decisions as claims, not as observed evidence", async () => {
    const llm: PromptOrchestratorLlm = {
      complete: async () =>
        composition("A reader by a tall window in golden hour"),
      completeWithTools: async (request) => {
        const answered = request.messages.some((message) => message.role === "tool");
        if (!answered) {
          return {
            content: "",
            toolCalls: [
              {
                id: "search-1",
                name: "search_vocabulary",
                arguments: JSON.stringify({
                  queries: [
                    {
                      slotId: "lighting",
                      category: "lighting",
                      query: "golden hour",
                    },
                  ],
                }),
              },
            ],
          };
        }
        return {
          content: JSON.stringify({
            initialPrompt: "core",
            completePrompt: "A reader by a tall window in golden hour",
            fields: [],
            termDecisions: [
              {
                slotId: "lighting",
                category: "lighting",
                sourceText: "window light",
                strategy: "reuse",
                termIds: ["light-a"],
                output: "golden hour",
                rationale: "the candidate matched the requested warmth",
              },
            ],
          }),
          toolCalls: [],
        };
      },
    };
    const result = await new PromptOrchestrator({ vocabulary, llm }).orchestrate(
      baseInput(),
    );

    expect(result.evidence?.observations.modelDecisions).toBe(1);
    expect(result.evidence?.observations.policyDecisions).toBe(0);
    // The rationale belongs to the model, not to observed behaviour.
    expect(result.evidence?.modelClaims).toBe(1);
    expect(result.evidence?.effectInferences).toEqual([]);
    expect(result.evidence?.observations.retrievalQueries).toBe(
      result.retrievalSummary?.queryCount ?? 0,
    );
  });

  it("labels policy decisions as non-model when the human drives the draft", async () => {
    const result = await new PromptOrchestrator({
      vocabulary,
      llm: textLlm("A reader by a tall window in soft rim light"),
    }).orchestrate(
      baseInput({
        guidanceMode: "human-led",
        lockedTermIds: ["light-b"],
        selectedTermIds: ["light-b"],
      }),
    );

    expect(result.evidence?.observations.modelDecisions).toBe(0);
    expect(result.evidence?.observations.policyDecisions).toBeGreaterThan(0);
    expect(result.evidence?.modelClaims).toBe(0);
  });

  it("states that a single run cannot attribute downstream image quality", async () => {
    const result = await new PromptOrchestrator({
      vocabulary,
      llm: textLlm("A reader by a tall window in soft rim light"),
    }).orchestrate(baseInput());

    expect(result.evidence?.effectInferences).toEqual([]);
    expect(result.evidence?.observations.referenceCards).toBe(0);
    expect(result.evidence?.observations.knowledgeModules).toBe(0);
    expect(result.assembly).toBeDefined();
  });
});

describe("deterministic final assembly", () => {
  it("marks the layout output as Core-assembled and keeps fixed fields", async () => {
    const llm: PromptOrchestratorLlm = {
      complete: async () =>
        JSON.stringify({
          initialPrompt: "poster",
          completePrompt: "A poster with one centred headline",
          fields: [],
          layoutCaptions: ["A bold centred headline"],
        }),
    };
    const result = await new PromptOrchestrator({ vocabulary, llm }).orchestrate(
      baseInput({
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
      }),
    );

    expect(result.assembly?.strategy).toBe("deterministic");
    expect(result.assembly?.deterministicParts).toContain("layout-json");
    expect(result.assembly?.deterministicParts).toContain("fixed-fields");
    expect(result.completePrompt).toContain("HELLO");
  });

  it("keeps a model-written prompt as model-assisted even when fields are merged", async () => {
    const result = await new PromptOrchestrator({
      vocabulary,
      llm: textLlm("A reader by a tall window in golden hour"),
    }).orchestrate(baseInput());

    expect(result.assembly?.strategy).toBe("model-assisted");
    expect(result.assembly?.deterministicParts).toContain("fixed-fields");
    expect(result.assembly?.deterministicParts).not.toContain("layout-json");
  });

  it("reports a locked term the model omitted instead of silently rewriting the text", async () => {
    const result = await new PromptOrchestrator({
      vocabulary,
      llm: textLlm("A reader by a tall window in warm light"),
    }).orchestrate(
      baseInput({
        guidanceMode: "human-led",
        lockedTermIds: ["light-a"],
        selectedTermIds: ["light-a"],
      }),
    );

    expect(result.assembly?.verifiedFacts).not.toContain("golden hour");
    expect(result.assembly?.missingFacts).toContain("golden hour");
    expect(result.completePrompt).not.toContain("golden hour");
    expect(result.warnings.join(" ")).toContain("golden hour");
  });

  it("confirms a locked term the model preserved", async () => {
    const result = await new PromptOrchestrator({
      vocabulary,
      llm: textLlm("A reader by a tall window in golden hour"),
    }).orchestrate(
      baseInput({
        guidanceMode: "human-led",
        lockedTermIds: ["light-a"],
        selectedTermIds: ["light-a"],
      }),
    );

    expect(result.assembly?.verifiedFacts).toContain("golden hour");
    expect(result.assembly?.missingFacts).not.toContain("golden hour");
    expect(result.warnings.join(" ")).not.toContain("golden hour");
  });

  it("compares storage syntax against the written form, not the raw row", async () => {
    vocabulary.addTerm({
      id: "cloth-a",
      category: "clothing",
      en: "torn_shorts",
      validationStatus: "validated",
      createdAt: "2026-11-26T00:00:00.000Z",
    });
    vocabulary.addTerm({
      id: "style-a",
      category: "style",
      en: "((wash painting)), ((ink wash))",
      validationStatus: "validated",
      createdAt: "2026-11-26T00:00:00.000Z",
    });
    const result = await new PromptOrchestrator({
      vocabulary,
      llm: textLlm("A runner in torn shorts, wash painting, ink wash treatment"),
    }).orchestrate(
      baseInput({
        guidanceMode: "human-led",
        lockedTermIds: ["cloth-a", "style-a"],
        selectedTermIds: ["cloth-a", "style-a"],
      }),
    );

    expect(result.assembly?.verifiedFacts).toEqual(
      expect.arrayContaining(["torn_shorts", "((wash painting)), ((ink wash))"]),
    );
    expect(result.assembly?.missingFacts).toEqual([]);
  });

  it("still reports a term the model genuinely dropped", async () => {
    vocabulary.addTerm({
      id: "cloth-b",
      category: "clothing",
      en: "torn_shorts",
      validationStatus: "validated",
      createdAt: "2026-11-26T00:00:00.000Z",
    });
    const result = await new PromptOrchestrator({
      vocabulary,
      llm: textLlm("A runner in a plain tracksuit"),
    }).orchestrate(
      baseInput({
        guidanceMode: "human-led",
        lockedTermIds: ["cloth-b"],
        selectedTermIds: ["cloth-b"],
      }),
    );

    expect(result.assembly?.missingFacts).toContain("torn_shorts");
    expect(result.warnings.join(" ")).toContain("torn_shorts");
  });

  it("reports a locked Chinese term the output did not keep", async () => {
    vocabulary.addTerm({
      id: "cloth-cn",
      category: "clothing",
      en: "黑色风衣",
      validationStatus: "validated",
      createdAt: "2026-11-26T00:00:00.000Z",
    });
    const result = await new PromptOrchestrator({
      vocabulary,
      llm: textLlm("A man in a black coat crossing a wet street"),
    }).orchestrate(
      baseInput({
        guidanceMode: "human-led",
        lockedTermIds: ["cloth-cn"],
        selectedTermIds: ["cloth-cn"],
      }),
    );

    // A locked term is a promise to the user: dropping it must be reported,
    // even when the stored wording is Chinese and the prompt is English.
    expect(result.assembly?.missingFacts).toContain("黑色风衣");
    expect(result.warnings.join(" ")).toContain("黑色风衣");
  });

  it("does not report a merely recommended Chinese term", async () => {
    vocabulary.addTerm({
      id: "cloth-cn-2",
      category: "clothing",
      en: "灰色围巾",
      validationStatus: "validated",
      createdAt: "2026-11-26T00:00:00.000Z",
    });
    const result = await new PromptOrchestrator({
      vocabulary,
      llm: textLlm("A woman in a grey scarf crossing a wet street"),
    }).orchestrate(
      baseInput({
        guidanceMode: "human-led",
        selectedTermIds: ["cloth-cn-2"],
      }),
    );

    expect(result.assembly?.missingFacts).not.toContain("灰色围巾");
  });

  it("reports a missing trigger word without injecting it", async () => {
    const result = await new PromptOrchestrator({
      vocabulary,
      llm: textLlm("A quiet street at dusk"),
    }).orchestrate(baseInput({ modelId: "moss-local" }));

    expect(result.assembly?.missingFacts).toContain("moss fidelity");
    expect(result.completePrompt).toBe("A quiet street at dusk");
    expect(result.warnings.join(" ")).toContain("moss fidelity");
  });

  it("produces the same deterministic report for the same input", async () => {
    const run = async () =>
      new PromptOrchestrator({
        vocabulary,
        llm: textLlm("A reader by a tall window in golden hour"),
      }).orchestrate(baseInput());
    const first = await run();
    const second = await run();
    expect(first.assembly).toEqual(second.assembly);
    expect(first.evidence).toEqual(second.evidence);
  });
});