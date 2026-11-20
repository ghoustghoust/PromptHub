import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DatabaseAdapter,
  PromptVocabDB,
  SCHEMA_INDEXES,
  SCHEMA_TABLES,
} from "@prompthub/db";
import { PromptOrchestrator } from "../src/prompt-orchestrator";
import { isDynamicPolish } from "../src/prompt-orchestrator-dynamic-polish";
import type { PromptOrchestratorLlm } from "../src/prompt-orchestrator-llm";
import type { PromptOrchestrationInput } from "@prompthub/shared/types";

let database: DatabaseAdapter.Database;
let vocabulary: PromptVocabDB;

beforeEach(() => {
  database = new DatabaseAdapter(":memory:");
  database.exec(SCHEMA_TABLES);
  database.exec(SCHEMA_INDEXES);
  vocabulary = new PromptVocabDB(database);
  const lighting = [
    ["light-1", "soft light", "shared", "validated"],
    ["light-2", "soft_light", "shared", "validated"],
    ["light-3", "soft light with gentle falloff across the wooden table", "shared", "validated"],
    ["light-4", "golden hour", "shared", "validated"],
    ["light-5", "old soft light", "shared", "deprecated"],
    ["light-6", "anime cel glow", "anime", "validated"],
    ["light-7", "studio flash", "real", "validated"],
    ["light-8", "dim ambient glow", "shared", "unvalidated"],
    ["light-9", "strip light", "shared", "validated"],
    ["light-10", "practical light", "shared", "unvalidated"],
    ["light-11", "light rays", "shared", "validated"],
    ["light-12", "anime soft light", "anime", "validated"],
  ] as const;
  for (const [id, en, domain, validationStatus] of lighting) {
    vocabulary.addTerm({
      id,
      category: "lighting",
      en,
      domain,
      validationStatus,
      applicableModels: id === "light-9" ? ["model-other"] : [],
      createdAt: "2026-11-18T00:00:00.000Z",
    });
  }
  vocabulary.addTerm({
    id: "cam-1",
    category: "camera",
    en: "85mm lens",
    validationStatus: "validated",
    createdAt: "2026-11-18T00:00:00.000Z",
  });
  vocabulary.addTerm({
    id: "cam-2",
    category: "camera",
    en: "wide angle",
    validationStatus: "validated",
    createdAt: "2026-11-18T00:00:00.000Z",
  });
  vocabulary.addTerm({
    id: "art-1",
    category: "artist",
    en: "some artist",
    validationStatus: "validated",
    createdAt: "2026-11-18T00:00:00.000Z",
  });
  vocabulary.addTerm({
    id: "char-1",
    category: "character",
    en: "blue hair girl",
    validationStatus: "validated",
    createdAt: "2026-11-18T00:00:00.000Z",
  });
  vocabulary.addTerm({
    id: "nsfw-1",
    category: "nsfw",
    en: "explicit pose",
    validationStatus: "validated",
    createdAt: "2026-11-18T00:00:00.000Z",
  });
  vocabulary.addTerm({
    id: "style-1",
    category: "style",
    en: "watercolor",
    validationStatus: "validated",
    createdAt: "2026-11-18T00:00:00.000Z",
  });
  vocabulary.addRelation("light-1", "light-3", "conflict");
});

afterEach(() => database.close());

interface LlmCall {
  system: string;
  user: string;
  mode: string;
  maxTokens?: number;
}

function scriptedLlm(responses: string[]): { llm: PromptOrchestratorLlm; calls: LlmCall[] } {
  const calls: LlmCall[] = [];
  const llm: PromptOrchestratorLlm = {
    complete: async (request) => {
      calls.push({
        system: request.messages.system,
        user: request.messages.user,
        mode: request.mode,
        maxTokens: request.maxTokens,
      });
      return responses.shift() ?? finalComposition([createDecision()]);
    },
  };
  return { llm, calls };
}

function finalComposition(decisions: Record<string, unknown>[]): string {
  return JSON.stringify({
    initialPrompt: "source",
    completePrompt: "polished output",
    fields: [],
    termDecisions: decisions,
  });
}

function createDecision(): Record<string, unknown> {
  return {
    slotId: "lighting",
    category: "lighting",
    sourceText: "soft light",
    strategy: "create",
    termIds: [],
    output: "soft diffused light",
    rationale: "original expression",
  };
}

function followUpOnly(slotId: string, category: string, query: string): string {
  return JSON.stringify({
    followUpQueries: [{ slotId, category, query }],
  });
}

function planResponse(queries: unknown): string {
  return JSON.stringify({ queries });
}

const lightingQuery = {
  slotId: "lighting",
  category: "lighting",
  query: "soft light",
  alternateQuery: "柔和光线",
  purpose: "compare",
  depth: "focused",
};

function polishInput(
  overrides: Partial<PromptOrchestrationInput> = {},
): PromptOrchestrationInput {
  return {
    prompt: "a quiet study",
    mode: "polish",
    guidanceMode: "agent-led",
    outputFormat: "caption",
    ...overrides,
  };
}

function retrievalGroups(call: LlmCall): Array<Record<string, unknown>> {
  const payload = JSON.parse(call.user) as { retrieval?: unknown[] };
  return (payload.retrieval ?? []) as Array<Record<string, unknown>>;
}

describe("dynamic polish mode detection", () => {
  it("enables the dynamic path only for agent-led caption or tags polish", () => {
    expect(isDynamicPolish(polishInput())).toBe(true);
    expect(isDynamicPolish(polishInput({ outputFormat: "tags" }))).toBe(true);
    expect(isDynamicPolish(polishInput({ outputFormat: "layout" }))).toBe(false);
    expect(isDynamicPolish(polishInput({ guidanceMode: "human-led" }))).toBe(false);
    expect(isDynamicPolish(polishInput({ mode: "expand" }))).toBe(false);
  });
});

describe("PromptOrchestrator dynamic polish", () => {
  it("plans retrieval, composes once and reports real retrieval counts", async () => {
    const { llm, calls } = scriptedLlm([
      planResponse([lightingQuery]),
      finalComposition([
        {
          slotId: "lighting",
          category: "lighting",
          sourceText: "soft light",
          strategy: "create",
          termIds: [],
          output: "soft diffused light",
          rationale: "original expression",
        },
      ]),
    ]);
    const result = await new PromptOrchestrator({ vocabulary, llm }).orchestrate(
      polishInput(),
    );
    expect(result.status).toBe("complete");
    expect(calls).toHaveLength(2);
    expect(calls[0].mode).toBe("polish");
    expect(calls[0].maxTokens).toBe(1600);
    expect(calls[0].system).toContain("queries array");
    expect(calls[1].system).toContain("Dynamic polish knowledge contract");
    expect(result.retrievalSummary?.rounds).toBe(1);
    expect(result.retrievalSummary?.queryCount).toBe(1);
    expect(result.retrievalSummary?.candidateCount).toBeGreaterThanOrEqual(1);
    expect(result.retrievalSummary?.candidateCount).toBeLessThanOrEqual(6);
    const groups = retrievalGroups(calls[1]);
    expect(groups).toHaveLength(1);
    expect(groups[0].slotId).toBe("lighting");
    expect(groups[0].status).toBe("match");
    const candidates = groups[0].candidates as Array<Record<string, unknown>>;
    expect(candidates[0].id).toBe("light-1");
    expect(result.termDecisions).toHaveLength(1);
    expect(result.termDecisions?.[0].strategy).toBe("create");
    expect(result.completePrompt).toBe("polished output");
  });

  it("executes one follow-up round, replaces the slot candidates and finalizes", async () => {
    const { llm, calls } = scriptedLlm([
      planResponse([lightingQuery]),
      followUpOnly("lighting", "lighting", "golden hour"),
      finalComposition([
        {
          slotId: "lighting",
          category: "lighting",
          sourceText: "soft light",
          strategy: "reuse",
          termIds: ["light-4"],
          output: "golden hour",
          rationale: "exact anchor",
        },
      ]),
    ]);
    const result = await new PromptOrchestrator({ vocabulary, llm }).orchestrate(
      polishInput(),
    );
    expect(result.status).toBe("complete");
    expect(calls).toHaveLength(3);
    expect(result.retrievalSummary).toEqual({
      rounds: 2,
      queryCount: 2,
      candidateCount: 1,
    });
    const firstRound = retrievalGroups(calls[1]);
    expect(JSON.stringify(firstRound)).toContain("soft light");
    const secondRound = retrievalGroups(calls[2]);
    expect(JSON.stringify(secondRound)).toContain("golden hour");
    expect(JSON.stringify(secondRound)).not.toContain("soft light");
    expect(result.selectedTerms.map((term) => term.id)).toEqual(["light-4"]);
  });

  it("refuses a third retrieval round and degrades instead of looping", async () => {
    const { llm, calls } = scriptedLlm([
      planResponse([lightingQuery]),
      followUpOnly("lighting", "lighting", "golden hour"),
      followUpOnly("lighting", "lighting", "window light"),
    ]);
    const result = await new PromptOrchestrator({ vocabulary, llm }).orchestrate(
      polishInput(),
    );
    expect(result.status).toBe("degraded");
    expect(calls).toHaveLength(3);
    expect(result.warnings.join(" ")).toContain("LLM composition failed");
    expect(result.termDecisions).toBeUndefined();
  });

  it("rejects plans with more than four queries or duplicate slot ids", async () => {
    const tooMany = await new PromptOrchestrator({
      vocabulary,
      llm: scriptedLlm([
        planResponse([
          lightingQuery,
          { ...lightingQuery, slotId: "camera", category: "camera", query: "lens" },
          { ...lightingQuery, slotId: "style", category: "style", query: "water" },
          { ...lightingQuery, slotId: "pose", category: "pose", query: "sitting" },
          { ...lightingQuery, slotId: "props", category: "props", query: "chair" },
        ]),
      ]).llm,
    }).orchestrate(polishInput());
    expect(tooMany.status).toBe("degraded");

    const duplicated = await new PromptOrchestrator({
      vocabulary,
      llm: scriptedLlm([
        planResponse([lightingQuery, { ...lightingQuery, query: "golden hour" }]),
      ]).llm,
    }).orchestrate(polishInput());
    expect(duplicated.status).toBe("degraded");
    expect(duplicated.warnings.join(" ")).toContain("LLM composition failed");
  });

  it("allows zero queries and keeps explicit locked terms as fixed facts", async () => {
    const { llm, calls } = scriptedLlm([
      planResponse([]),
      finalComposition([
        {
          slotId: "intent",
          category: "style",
          sourceText: "a quiet study",
          strategy: "create",
          termIds: [],
          output: "a quiet study",
          rationale: "nothing to retrieve",
        },
      ]),
    ]);
    const result = await new PromptOrchestrator({ vocabulary, llm }).orchestrate(
      polishInput({ selectedTermIds: ["style-1"], lockedTermIds: ["style-1"] }),
    );
    expect(result.status).toBe("complete");
    expect(result.selectedTerms.map((term) => term.id)).toEqual(["style-1"]);
    expect(result.selectedTerms[0].locked).toBe(true);
    expect(result.retrievalSummary).toEqual({
      rounds: 0,
      queryCount: 0,
      candidateCount: 0,
    });
    const fixed = result.fields.find(
      (field) => field.termId === "style-1" && field.layer === "fixed",
    );
    expect(fixed?.source).toBe("vocabulary");
    expect(calls[0].user).toContain("style-1");
  });

  it("never retrieves artist, character or NSFW categories even when the model asks", async () => {
    const { llm, calls } = scriptedLlm([
      planResponse([
        { slotId: "artist", category: "artist", query: "some artist", purpose: "resolve", depth: "exact" },
        { slotId: "character", category: "character", query: "blue hair girl", purpose: "resolve", depth: "exact" },
        { slotId: "nsfw", category: "nsfw", query: "explicit pose", purpose: "resolve", depth: "exact" },
        lightingQuery,
      ]),
      finalComposition([
        {
          slotId: "lighting",
          category: "lighting",
          sourceText: "soft light",
          strategy: "create",
          termIds: [],
          output: "soft diffused light",
          rationale: "original",
        },
      ]),
    ]);
    const result = await new PromptOrchestrator({ vocabulary, llm }).orchestrate(
      polishInput(),
    );
    expect(result.status).toBe("complete");
    expect(result.retrievalSummary?.candidateCount).toBeGreaterThanOrEqual(1);
    expect(result.retrievalSummary?.candidateCount).toBeLessThanOrEqual(6);
    expect(calls[0].system).toContain(
      "Do not query artist, character or NSFW categories",
    );
    const groups = retrievalGroups(calls[1]);
    const bySlot = new Map(groups.map((group) => [group.slotId as string, group]));
    for (const forbidden of ["artist", "character", "nsfw"]) {
      expect(bySlot.get(forbidden)?.status).toBe("no_match");
      expect(bySlot.get(forbidden)?.candidates).toEqual([]);
    }
    expect(bySlot.get("lighting")?.status).toBe("match");
    expect(result.selectedTerms.map((term) => term.category)).not.toContain(
      "artist",
    );
  });

  it("ranks exact matches first, suppresses near duplicates and skips deprecated terms", async () => {
    const { llm, calls } = scriptedLlm([
      planResponse([{ ...lightingQuery, depth: "exact" }]),
      finalComposition([createDecision()]),
    ]);
    await new PromptOrchestrator({ vocabulary, llm }).orchestrate(polishInput());
    const groups = retrievalGroups(calls[1]);
    const candidates = (groups[0].candidates ?? []) as Array<{ id: string }>;
    expect(candidates[0].id).toBe("light-1");
    expect(candidates.map((candidate) => candidate.id)).toContain("light-3");
    expect(candidates.map((candidate) => candidate.id)).not.toContain("light-2");
    expect(candidates.map((candidate) => candidate.id)).not.toContain("light-5");
    expect(candidates.length).toBeLessThanOrEqual(3);
  });

  it("applies a per-slot candidate budget so no slot starves the others", async () => {
    const { llm, calls } = scriptedLlm([
      planResponse([
        lightingQuery,
        { slotId: "camera", category: "camera", query: "lens", purpose: "compare", depth: "focused" },
      ]),
      finalComposition([createDecision()]),
    ]);
    const result = await new PromptOrchestrator({ vocabulary, llm }).orchestrate(
      polishInput({ vocabularyTokenBudget: 300 }),
    );
    expect(result.status).toBe("complete");
    const groups = retrievalGroups(calls[1]);
    expect(groups).toHaveLength(2);
    expect(groups[0].truncated).toBe(true);
    expect(((groups[0].candidates ?? []) as unknown[]).length).toBe(1);
    expect(((groups[0].candidates ?? []) as Array<{ id: string }>)[0].id).toBe(
      "light-1",
    );
    expect(groups[1].status).toBe("match");
    expect(((groups[1].candidates ?? []) as unknown[]).length).toBe(1);
    expect(result.retrievalSummary?.candidateCount).toBe(2);
  });

  it("audits the four strategies with real candidate linkage", async () => {
    const { llm } = scriptedLlm([
      planResponse([lightingQuery]),
      finalComposition([
        {
          slotId: "lighting",
          category: "lighting",
          sourceText: "soft light",
          strategy: "reuse",
          termIds: ["light-1"],
          output: "soft light",
          rationale: "exact",
        },
        {
          slotId: "lighting2",
          category: "lighting",
          sourceText: "light quality",
          strategy: "adapt",
          termIds: ["light-12"],
          output: "soft anime light from the side",
          rationale: "anchor plus context",
        },
        {
          slotId: "mood",
          category: "style",
          sourceText: "mood",
          strategy: "create",
          termIds: [],
          output: "painted highlights",
          rationale: "original",
        },
        {
          slotId: "extra",
          category: "props",
          sourceText: "unneeded detail",
          strategy: "ignore",
          termIds: ["light-3"],
          output: "should be forced empty",
          rationale: "not needed",
        },
      ]),
    ]);
    const result = await new PromptOrchestrator({ vocabulary, llm }).orchestrate(
      polishInput(),
    );
    expect(result.status).toBe("complete");
    const decisions = result.termDecisions ?? [];
    expect(decisions).toHaveLength(4);
    expect(decisions.map((decision) => decision.strategy)).toEqual([
      "reuse",
      "adapt",
      "create",
      "ignore",
    ]);
    expect(decisions[0].terms.map((term) => term.id)).toEqual(["light-1"]);
    expect(decisions[0].terms[0].en).toBe("soft light");
    expect(decisions[2].terms).toEqual([]);
    expect(decisions[3].output).toBe("");
    const reused = result.selectedTerms.filter(
      (term) => term.id === "light-1" || term.id === "light-12",
    );
    expect(reused).toHaveLength(2);
    expect(reused.map((term) => term.locked)).toEqual([false, false]);
    expect(reused.map((term) => term.selectionReason)).toEqual([
      "relevance",
      "relevance",
    ]);
  });

  it("repairs decisions with unknown term ids and rejects structural violations", async () => {
    const repaired = await new PromptOrchestrator({
      vocabulary,
      llm: scriptedLlm([
        planResponse([lightingQuery]),
        finalComposition([
          {
            slotId: "lighting",
            category: "lighting",
            sourceText: "soft light",
            strategy: "reuse",
            termIds: ["ghost-id"],
            output: "soft light",
            rationale: "broken reference",
          },
          {
            slotId: "extra",
            category: "props",
            sourceText: "unneeded",
            strategy: "ignore",
            termIds: [],
            output: "must be emptied",
            rationale: "ignored",
          },
        ]),
      ]).llm,
    }).orchestrate(polishInput());
    expect(repaired.status).toBe("complete");
    expect(repaired.termDecisions?.[0].strategy).toBe("create");
    expect(repaired.termDecisions?.[0].terms).toEqual([]);
    expect(repaired.termDecisions?.[1].output).toBe("");
    expect(repaired.warnings.join(" ")).toContain("ghost-id");
    expect(repaired.warnings.join(" ")).toContain("was changed to create");

    const tooManyIds = await new PromptOrchestrator({
      vocabulary,
      llm: scriptedLlm([
        planResponse([lightingQuery]),
        finalComposition([
          {
            slotId: "lighting",
            category: "lighting",
            sourceText: "soft light",
            strategy: "reuse",
            termIds: Array.from({ length: 9 }, (_, index) => `id-${index}`),
            output: "soft light",
            rationale: "too many",
          },
        ]),
      ]).llm,
    }).orchestrate(polishInput());
    expect(tooManyIds.status).toBe("degraded");

    const badStrategy = await new PromptOrchestrator({
      vocabulary,
      llm: scriptedLlm([
        planResponse([lightingQuery]),
        finalComposition([
          {
            slotId: "lighting",
            category: "lighting",
            sourceText: "soft light",
            strategy: "swap",
            termIds: [],
            output: "soft light",
            rationale: "unknown strategy",
          },
        ]),
      ]).llm,
    }).orchestrate(polishInput());
    expect(badStrategy.status).toBe("degraded");

    const tooManyDecisions = await new PromptOrchestrator({
      vocabulary,
      llm: scriptedLlm([
        planResponse([lightingQuery]),
        finalComposition(
          Array.from({ length: 33 }, (_, index) => ({
            slotId: `slot-${index}`,
            category: "lighting",
            sourceText: "soft light",
            strategy: "create",
            termIds: [],
            output: "soft light",
            rationale: "overflow",
          })),
        ),
      ]).llm,
    }).orchestrate(polishInput());
    expect(tooManyDecisions.status).toBe("degraded");
  });

  it("enforces domain, model, validation and diversity gates on retrieval", async () => {
    const { llm, calls } = scriptedLlm([
      planResponse([{ ...lightingQuery, query: "light" }]),
      finalComposition([createDecision()]),
    ]);
    const result = await new PromptOrchestrator({ vocabulary, llm }).orchestrate(
      polishInput({
        domain: "anime",
        modelId: "model-main",
        validatedOnly: true,
      }),
    );
    expect(result.status).toBe("complete");
    const groups = retrievalGroups(calls[1]);
    const candidates = ((groups[0].candidates ?? []) as Array<{ id: string }>).map(
      (candidate) => candidate.id,
    );
    expect(candidates).toContain("light-12");
    expect(candidates).toContain("light-1");
    expect(candidates).not.toContain("light-7");
    expect(candidates).not.toContain("light-9");
    expect(candidates).not.toContain("light-10");
    expect(candidates).not.toContain("light-2");
    expect(new Set(candidates).size).toBe(candidates.length);
  });

  it("rejects dynamic candidates that conflict with locked terms", async () => {
    const { llm } = scriptedLlm([
      planResponse([{ ...lightingQuery, query: "soft light" }]),
      finalComposition([
        {
          slotId: "lighting",
          category: "lighting",
          sourceText: "soft light",
          strategy: "reuse",
          termIds: ["light-3"],
          output: "soft light across the table",
          rationale: "anchor",
        },
      ]),
    ]);
    const result = await new PromptOrchestrator({ vocabulary, llm }).orchestrate(
      polishInput({ lockedTermIds: ["light-1"], selectedTermIds: ["light-1"] }),
    );
    expect(result.status).toBe("degraded");
    expect(result.warnings.join(" ")).toContain("conflicting vocabulary terms");
    expect(result.selectedTerms.map((term) => term.id)).toEqual(["light-1"]);
    expect(result.completePrompt).toContain("soft light");
  });

  it("keeps layout polish on the deterministic static path", async () => {
    const { llm, calls } = scriptedLlm([
      JSON.stringify({
        initialPrompt: "poster",
        completePrompt: "A poster with one centred headline",
        fields: [],
        layoutCaptions: ["A bold centred headline"],
      }),
    ]);
    const result = await new PromptOrchestrator({ vocabulary, llm }).orchestrate({
      prompt: "A poster with one centred headline",
      mode: "polish",
      skill: "moodyMoss",
      outputFormat: "layout",
      guidanceMode: "agent-led",
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
    expect(result.status).toBe("complete");
    expect(result.termDecisions).toBeUndefined();
    expect(result.retrievalSummary).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it("disables retrieval entirely when the vocabulary budget is zero", async () => {
    const { llm, calls } = scriptedLlm([
      planResponse([lightingQuery]),
      finalComposition([createDecision()]),
    ]);
    const result = await new PromptOrchestrator({ vocabulary, llm }).orchestrate(
      polishInput({ vocabularyTokenBudget: 0 }),
    );
    expect(result.status).toBe("complete");
    expect(result.retrievalSummary).toEqual({
      rounds: 0,
      queryCount: 0,
      candidateCount: 0,
    });
    expect(result.warnings.join(" ")).toContain(
      "Automatic vocabulary context budget is zero",
    );
    const groups = retrievalGroups(calls[1]);
    expect(groups[0].status).toBe("no_match");
    expect(groups[0].candidates).toEqual([]);
  });

  it("rejects null bytes, over-long queries and non-array plans with degradation", async () => {
    const nullByte = await new PromptOrchestrator({
      vocabulary,
      llm: scriptedLlm([
        planResponse([{ ...lightingQuery, query: "soft\0light" }]),
      ]).llm,
    }).orchestrate(polishInput());
    expect(nullByte.status).toBe("degraded");

    const tooLong = await new PromptOrchestrator({
      vocabulary,
      llm: scriptedLlm([
        planResponse([{ ...lightingQuery, query: "x".repeat(181) }]),
      ]).llm,
    }).orchestrate(polishInput());
    expect(tooLong.status).toBe("degraded");
    expect(tooLong.warnings.join(" ")).toContain("LLM composition failed");

    const notArray = await new PromptOrchestrator({
      vocabulary,
      llm: scriptedLlm([planResponse("lighting")]).llm,
    }).orchestrate(polishInput());
    expect(notArray.status).toBe("degraded");
    expect(notArray.warnings.join(" ")).toContain("LLM composition failed");
  });
});
