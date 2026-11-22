import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DatabaseAdapter,
  PromptVocabDB,
  SCHEMA_INDEXES,
  SCHEMA_TABLES,
} from "@prompthub/db";
import { deriveEntityAliases } from "@prompthub/shared/utils/prompt-entity-key";
import { PromptOrchestrator } from "../src/prompt-orchestrator";
import type { PromptOrchestratorLlm } from "../src/prompt-orchestrator-llm";
import type { PromptOrchestrationInput } from "@prompthub/shared/types";

let database: DatabaseAdapter.Database;
let vocabulary: PromptVocabDB;

const CREATED_AT = "2026-11-22T00:00:00.000Z";

function addTerm(id: string, category: string, en: string, extra: Record<string, unknown> = {}): void {
  vocabulary.addTerm({
    id,
    category,
    en,
    validationStatus: "validated",
    createdAt: CREATED_AT,
    ...extra,
  });
}

beforeEach(() => {
  database = new DatabaseAdapter(":memory:");
  database.exec(SCHEMA_TABLES);
  database.exec(SCHEMA_INDEXES);
  vocabulary = new PromptVocabDB(database);
  addTerm("light-1", "lighting", "soft light");
  addTerm("light-2", "lighting", "golden hour");
  addTerm("light-3", "lighting", "hard flash");
  addTerm("artist-1", "artist", "@wlop", { subcategory: "厚涂/半厚涂", domain: "anime" });
  addTerm("char-gen", "character", "ganyu (genshin impact)", {
    zh: "甘雨（原神）",
    subcategory: "原神",
    domain: "anime",
  });
  vocabulary.addTermAliases(
    deriveEntityAliases({ en: "ganyu (genshin impact)", zh: "甘雨（原神）" }).map((alias) => ({
      termId: "char-gen",
      alias: alias.alias,
      kind: alias.kind,
    })),
  );
});

afterEach(() => database.close());

function captionJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    initialPrompt: "source",
    completePrompt: "ganyu (genshin impact) in soft light",
    fields: [],
    ...overrides,
  });
}

function stubLlm(): PromptOrchestratorLlm {
  return { complete: async () => captionJson() };
}

function input(overrides: Partial<PromptOrchestrationInput> = {}): PromptOrchestrationInput {
  return {
    prompt: "ganyu (genshin impact) in a quiet room",
    mode: "expand",
    guidanceMode: "agent-led",
    outputFormat: "caption",
    ...overrides,
  };
}

describe("cross-mode decision provenance", () => {
  it("records locked, reference and excluded terms with their real outcome", async () => {
    const result = await new PromptOrchestrator({ vocabulary, llm: stubLlm() }).orchestrate(
      input({
        guidanceMode: "human-led",
        prompt: "a quiet portrait",
        selectedTermIds: ["light-1"],
        lockedTermIds: ["light-1"],
        referenceTermIds: ["light-2"],
        excludedTermIds: ["light-3"],
      }),
    );
    const byId = new Map(
      (result.provenance ?? []).map((entry) => [`${entry.kind}:${entry.termId ?? entry.label}`, entry]),
    );
    expect(byId.get("term:light-1")).toMatchObject({ state: "locked", outcome: "fixed" });
    expect(byId.get("term:light-2")).toMatchObject({ state: "reference", outcome: "absent" });
    expect(byId.get("term:light-3")).toMatchObject({ state: "excluded", outcome: "absent" });
    expect(result.termDecisions?.every((decision) => decision.origin === "policy")).toBe(true);
    expect(result.termDecisions?.map((decision) => decision.strategy)).toEqual(
      expect.arrayContaining(["reuse", "ignore"]),
    );
  });

  it("links a resolved identity to its fixed field", async () => {
    const result = await new PromptOrchestrator({ vocabulary, llm: stubLlm() }).orchestrate(
      input({ prompt: "ganyu (genshin impact) in a quiet room" }),
    );
    const entity = (result.provenance ?? []).find((entry) => entry.kind === "entity");
    expect(entity).toMatchObject({ state: "resolved", outcome: "fixed" });
    expect(entity?.excerpt).toContain("ganyu (genshin impact)");
    expect(entity?.origin).toBe("user");
  });

  it("records an injected Kaloscope artist as an injection, not prompt text", async () => {
    const result = await new PromptOrchestrator({ vocabulary, llm: stubLlm() }).orchestrate(
      input({
        prompt: "a quiet portrait",
        targetPipeline: "kaloscope",
        selectedTermIds: ["artist-1"],
      }),
    );
    const artist = (result.provenance ?? []).find((entry) => entry.kind === "artist");
    expect(artist).toMatchObject({ outcome: "injected" });
    expect(artist?.excerpt).toContain("artist_name=wlop");
    expect(artist?.excerpt).toContain("style_guidance=6");
  });

  it("keeps provenance on a degraded result and marks policy decisions", async () => {
    const failing: PromptOrchestratorLlm = {
      complete: async () => {
        throw new Error("model offline");
      },
    };
    const result = await new PromptOrchestrator({ vocabulary, llm: failing }).orchestrate(
      input({
        guidanceMode: "human-led",
        prompt: "a quiet portrait",
        selectedTermIds: ["light-1"],
      }),
    );
    expect(result.status).toBe("degraded");
    expect(result.provenance?.some((entry) => entry.termId === "light-1")).toBe(true);
    expect(result.termDecisions?.every((decision) => decision.origin === "policy")).toBe(true);
  });
});