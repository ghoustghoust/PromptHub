import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DatabaseAdapter,
  PromptVocabDB,
  SCHEMA_INDEXES,
  SCHEMA_TABLES,
} from "@prompthub/db";
import {
  VocabularyRetriever,
  classifyRelation,
  relationPolicyFor,
} from "../src/prompt-vocabulary-retrieval";
import {
  SEARCH_VOCABULARY_TOOL,
  createVocabularyToolState,
  executeVocabularyTool,
} from "../src/prompt-vocabulary-tools";
import type { PromptOrchestrationInput } from "@prompthub/shared/types";

let database: DatabaseAdapter.Database;
let vocabulary: PromptVocabDB;

const CREATED_AT = "2026-11-22T00:00:00.000Z";

function addTerm(id: string, category: string, en: string, zh: string | null = null): void {
  vocabulary.addTerm({
    id,
    category,
    en,
    zh,
    validationStatus: "validated",
    createdAt: CREATED_AT,
  });
}

beforeEach(() => {
  database = new DatabaseAdapter(":memory:");
  database.exec(SCHEMA_TABLES);
  database.exec(SCHEMA_INDEXES);
  vocabulary = new PromptVocabDB(database);
  addTerm("light-1", "lighting", "soft light");
  addTerm("light-2", "lighting", "light");
  addTerm("light-3", "lighting", "soft light with gentle falloff");
  addTerm("light-4", "lighting", "hard light");
  addTerm("light-5", "lighting", "warm shadow");
  addTerm("cam-1", "camera", "85mm");
  addTerm("cam-2", "camera", "85mm lens");
  addTerm("cam-3", "camera", "50mm lens");
  addTerm("zh-1", "lighting", "柔光", "柔光");
});

afterEach(() => database.close());

function input(overrides: Partial<PromptOrchestrationInput> = {}): PromptOrchestrationInput {
  return {
    prompt: "a quiet room",
    mode: "polish",
    guidanceMode: "agent-led",
    outputFormat: "caption",
    vocabularyTokenBudget: 900,
    ...overrides,
  };
}

describe("candidate relation labels", () => {
  it("labels equivalence, specificity, relatedness and opposition", () => {
    expect(classifyRelation("soft light", ["soft light"])).toBe("equivalent");
    expect(classifyRelation("soft rim light", ["light rim soft"])).toBe("equivalent");
    expect(classifyRelation("light", ["soft light"])).toBe("narrower");
    expect(classifyRelation("soft light", ["light"])).toBe("broader");
    expect(classifyRelation("soft light", ["warm shadow"])).toBe("related");
    expect(classifyRelation("soft light", ["hard light"])).toBe("opposite");
    expect(classifyRelation("with hat", ["without hat"])).toBe("opposite");
  });

  it("gives opposite rows no positive relation even when tokens overlap", () => {
    expect(classifyRelation("day light", ["night light"])).toBe("opposite");
  });
});

describe("task relation policies", () => {
  it("restricts reverse to equivalent candidates and audits the rest", () => {
    const retriever = new VocabularyRetriever(vocabulary, input({ mode: "reverse" }));
    const result = retriever.search({
      slotId: "camera",
      category: "camera",
      query: "85mm",
      purpose: "resolve",
      depth: "focused",
    });
    expect(result.candidates.map((candidate) => candidate.term.id)).toEqual(["cam-1"]);
    expect(result.candidates[0].relation).toBe("equivalent");
    expect(result.excludedRelations).toEqual(
      expect.arrayContaining([{ id: "cam-2", en: "85mm lens", relation: "narrower" }]),
    );
  });

  it("lets expansion accept and prefer more specific rows", () => {
    const retriever = new VocabularyRetriever(vocabulary, input({ mode: "expand" }));
    const result = retriever.search({
      slotId: "lighting",
      category: "lighting",
      query: "light",
      purpose: "inspire",
      depth: "focused",
    });
    const relations = new Map(
      result.candidates.map((candidate) => [candidate.term.id, candidate.relation]),
    );
    expect(relations.get("light-2")).toBe("equivalent");
    expect(relations.get("light-1")).toBe("narrower");
    expect(relations.get("light-3")).toBe("narrower");
    // `hard light` is lexically a narrower kind of light, not an opposite here.
    expect(relations.get("light-4")).toBe("narrower");
    expect(result.candidates[0].term.id).toBe("light-2");
  });

  it("keeps equivalence first for polish while still allowing related material", () => {
    const retriever = new VocabularyRetriever(vocabulary, input({ mode: "polish" }));
    const result = retriever.search({
      slotId: "lighting",
      category: "lighting",
      query: "soft light",
      purpose: "compare",
      depth: "focused",
    });
    expect(result.candidates[0].term.id).toBe("light-1");
    expect(result.candidates[0].relation).toBe("equivalent");
    expect(result.candidates.map((candidate) => candidate.relation)).toContain("narrower");
    expect(result.candidates.map((candidate) => candidate.term.id)).not.toContain("light-4");
  });

  it("keeps the unfiltered policy for modes without a task rule", () => {
    const policy = relationPolicyFor("random");
    expect(policy.allowed.has("opposite")).toBe(true);
    const retriever = new VocabularyRetriever(vocabulary, input({ mode: "random" }));
    const result = retriever.search({
      slotId: "lighting",
      category: "lighting",
      query: "soft light",
      purpose: "compare",
      depth: "exploratory",
    });
    expect(result.candidates.map((candidate) => candidate.term.id)).toContain("light-4");
  });
});

describe("relation policy inside the search tool", () => {
  it("returns the relation with every candidate and excludes forbidden directions", () => {
    const state = createVocabularyToolState({
      input: input({ mode: "reverse" }),
      vocabulary,
      explicitTerms: [],
    });
    const outcome = executeVocabularyTool(
      SEARCH_VOCABULARY_TOOL,
      JSON.stringify({
        queries: [{ slotId: "camera", category: "camera", query: "85mm" }],
      }),
      state,
    );
    const payload = JSON.parse(outcome.content) as {
      groups: Array<{
        candidates: Array<{ id: string; relation: string }>;
        excludedRelations: Array<{ id: string }>;
      }>;
    };
    expect(payload.groups[0].candidates).toEqual([
      expect.objectContaining({ id: "cam-1", relation: "equivalent" }),
    ]);
    expect(payload.groups[0].excludedRelations.map((row) => row.id)).toContain("cam-2");
  });
});