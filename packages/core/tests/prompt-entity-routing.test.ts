import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DatabaseAdapter,
  PromptVocabDB,
  SCHEMA_INDEXES,
  SCHEMA_TABLES,
} from "@prompthub/db";
import {
  deriveEntityAliases,
  isNamedEntityTerm,
  normalizeEntityKey,
  splitEntityName,
} from "@prompthub/shared/utils/prompt-entity-key";
import { PromptOrchestrator } from "../src/prompt-orchestrator";
import { resolvePromptEntities } from "../src/prompt-entity-resolution";
import { buildPromptRoutePlan, classifyPromptSegment } from "../src/prompt-input-routing";
import { resolveArtistPipeline, routeArtistTerms } from "../src/prompt-artist-routing";
import { isDynamicPolish } from "../src/prompt-orchestrator-dynamic-polish";
import type { PromptOrchestratorLlm } from "../src/prompt-orchestrator-llm";
import type {
  PromptOrchestrationInput,
  PromptSelectedTerm,
} from "@prompthub/shared/types";

let database: DatabaseAdapter.Database;
let vocabulary: PromptVocabDB;

const CREATED_AT = "2026-11-22T00:00:00.000Z";

interface TermSeed {
  id: string;
  category: string;
  subcategory?: string | null;
  en: string;
  zh?: string | null;
  series?: string | null;
  validationStatus?: "pending" | "unvalidated" | "validated" | "deprecated";
}

function seed(term: TermSeed): void {
  vocabulary.addTerm({
    id: term.id,
    category: term.category,
    subcategory: term.subcategory ?? null,
    en: term.en,
    zh: term.zh ?? null,
    series: term.series ?? null,
    domain: "anime",
    validationStatus: term.validationStatus ?? "validated",
    createdAt: CREATED_AT,
  });
  // Mirrors the backfill: only identity-shaped rows get aliases.
  if (!isNamedEntityTerm({ ...term, subcategory: term.subcategory ?? null })) return;
  vocabulary.addTermAliases(
    deriveEntityAliases({ en: term.en, zh: term.zh ?? null }).map((alias) => ({
      termId: term.id,
      alias: alias.alias,
      kind: alias.kind,
    })),
  );
}

beforeEach(() => {
  database = new DatabaseAdapter(":memory:");
  database.exec(SCHEMA_TABLES);
  database.exec(SCHEMA_INDEXES);
  vocabulary = new PromptVocabDB(database);
  seed({ id: "char-gen", category: "character", subcategory: "原神", en: "ganyu (genshin impact)", zh: "甘雨（原神）" });
  seed({
    id: "char-sky",
    category: "character",
    subcategory: "原神",
    en: "ganyu \\(genshin impact\\), blue hair, long hair, horns, bare shoulders",
    zh: "甘雨",
  });
  seed({ id: "char-wb", category: "character", en: "ganyu", zh: "甘雨" });
  seed({ id: "char-raid", category: "character", subcategory: "原神", en: "raiden shogun", zh: "雷电将军" });
  seed({ id: "char-tag", category: "character", subcategory: "对象", en: "1girl", zh: "1女孩" });
  seed({ id: "artist-at", category: "artist", subcategory: "厚涂/半厚涂", en: "@wlop" });
  seed({ id: "artist-dan", category: "artist", subcategory: "danbooru", en: "wlop" });
  seed({ id: "artist-noise", category: "artist", subcategory: "danbooru", en: "!! (p7kwzcwyyhxsz6u)" });
  seed({ id: "char-old", category: "character", en: "retired hero", zh: "退役英雄", validationStatus: "deprecated" });
});

afterEach(() => database.close());

function captionJson(completePrompt = "composed output"): string {
  return JSON.stringify({
    initialPrompt: "source",
    completePrompt,
    fields: [],
  });
}

function stubLlm(text: string): PromptOrchestratorLlm {
  return { complete: async () => text };
}

function expandInput(overrides: Partial<PromptOrchestrationInput> = {}): PromptOrchestrationInput {
  return {
    prompt: "a portrait",
    mode: "expand",
    outputFormat: "caption",
    ...overrides,
  };
}

describe("entity key normalization", () => {
  it("splits a bundle row into identity, qualifier and appearance attributes", () => {
    const split = splitEntityName(
      "ganyu \\(genshin impact\\), blue hair, long hair, horns",
    );
    expect(split.head).toBe("ganyu");
    expect(split.qualifier).toBe("genshin impact");
    expect(split.attributes).toHaveLength(3);
  });

  it("normalizes @, weights, emphasis and spacing into one key", () => {
    expect(normalizeEntityKey("@wlop")).toBe("wlop");
    expect(normalizeEntityKey("((alphonse mucha))")).toBe("alphonse mucha");
    expect(normalizeEntityKey("Genderswap_\\(MTF\\)")).toBe("genderswap (mtf)");
  });

  it("rejects generic tags and symbol-only rows as named entities", () => {
    expect(isNamedEntityTerm({ category: "character", subcategory: "对象", en: "1girl" })).toBe(false);
    expect(isNamedEntityTerm({ category: "artist", subcategory: "danbooru", en: "!! (p7kwzcwyyhxsz6u)" })).toBe(false);
    expect(isNamedEntityTerm({ category: "character", subcategory: "原神", en: "ganyu (genshin impact)" })).toBe(true);
    expect(isNamedEntityTerm({ category: "style", subcategory: null, en: "watercolor" })).toBe(false);
  });
});

describe("prompt entity resolution", () => {
  it("resolves a series-qualified name and prefers the name-only row over the bundle", () => {
    const [entity] = resolvePromptEntities({
      vocabulary,
      prompt: "ganyu (genshin impact) standing in a garden",
    });
    expect(entity.status).toBe("resolved");
    expect(entity.displayName).toBe("ganyu (genshin impact)");
    expect(entity.termId).toBe("char-gen");
    expect(entity.candidates[0].termIds.sort()).toEqual(["char-gen", "char-sky"]);
    expect(entity.candidates[0].hasAppearanceBundle).toBe(true);
  });

  it("returns candidates instead of guessing when a short name maps to two identities", () => {
    const [entity] = resolvePromptEntities({ vocabulary, prompt: "ganyu in a garden" });
    expect(entity.status).toBe("ambiguous");
    expect(entity.termId).toBeUndefined();
    expect(entity.candidates.map((candidate) => candidate.displayName).sort()).toEqual([
      "ganyu",
      "ganyu (genshin impact)",
    ]);
  });

  it("resolves a CJK name through the zh alias and reports the same ambiguity", () => {
    const [entity] = resolvePromptEntities({ vocabulary, prompt: "甘雨站在花园里" });
    expect(entity.status).toBe("ambiguous");
    expect(entity.mention.text).toBe("甘雨");
    expect(entity.candidates).toHaveLength(2);
  });

  it("collapses @wlop and wlop into one artist identity", () => {
    const [entity] = resolvePromptEntities({ vocabulary, prompt: "painted by @wlop" });
    expect(entity.status).toBe("resolved");
    expect(entity.candidates[0].category).toBe("artist");
    expect(entity.termId).toBe("artist-at");
  });

  it("never resolves deprecated rows or generic identity tags", () => {
    expect(resolvePromptEntities({ vocabulary, prompt: "retired hero" })).toEqual([]);
    expect(resolvePromptEntities({ vocabulary, prompt: "1girl solo" })).toEqual([]);
  });
});

describe("input type routing", () => {
  it("marks identity, constraints and prose separately", () => {
    const segment = classifyPromptSegment("85mm", new Set());
    expect(segment.kind).toBe("constrained");
    expect(segment.verbatim).toBe(true);
    expect(segment.allowCreate).toBe(false);
    expect(classifyPromptSegment("不要红色", new Set()).allowCreate).toBe(false);
    expect(classifyPromptSegment("a woman reading by the window", new Set()).kind).toBe("prose");
  });

  it("chooses entity-only when nothing descriptive remains", () => {
    const entities = resolvePromptEntities({
      vocabulary,
      prompt: "ganyu (genshin impact), @wlop",
    });
    const plan = buildPromptRoutePlan({
      prompt: "ganyu (genshin impact), @wlop",
      entities,
      pipeline: "anima",
    });
    expect(plan.path).toBe("entity-only");
    expect(plan.allowCreate).toBe(false);
    expect(plan.segments.map((segment) => segment.kind)).toEqual([
      "named-entity",
      "named-entity",
    ]);
    expect(plan.forbiddenCategories).toEqual(["artist", "character", "nsfw"]);
  });

  it("keeps the lexical path for plain descriptions and warns on ambiguity", () => {
    const prompt = "ganyu at dusk";
    const entities = resolvePromptEntities({ vocabulary, prompt });
    const plan = buildPromptRoutePlan({ prompt, entities, pipeline: "moss" });
    expect(plan.path).toBe("hybrid");
    expect(plan.warnings.some((warning) => warning.includes("ambiguous"))).toBe(true);
  });
});

function artistTerm(overrides: Partial<PromptSelectedTerm> = {}): PromptSelectedTerm {
  return {
    id: "artist-at",
    category: "artist",
    en: "@wlop",
    zh: null,
    series: null,
    template: null,
    source: "skyloong-taglib",
    validationStatus: "validated",
    locked: false,
    selectionReason: "explicit",
    ...overrides,
  };
}

describe("artist routing by pipeline", () => {
  it("derives the pipeline from the rule card and accepts an explicit override", () => {
    expect(resolveArtistPipeline({ skill: "k2" })).toBe("k2");
    expect(resolveArtistPipeline({ skill: "moss" })).toBe("moss");
    expect(resolveArtistPipeline({ skill: "minimaxH3" })).toBe("h3");
    expect(resolveArtistPipeline({ skill: "moss", targetPipeline: "anima" })).toBe("anima");
    expect(resolveArtistPipeline({})).toBe("unknown");
  });

  it("keeps @artist for Anima and strips it for MOSS", () => {
    const anima = routeArtistTerms([artistTerm()], "anima");
    expect(anima.terms[0].en).toBe("@wlop");
    expect(anima.routes[0].promptToken).toBe("@wlop");

    const moss = routeArtistTerms([artistTerm()], "moss");
    expect(moss.terms[0].en).toBe("wlop");
    expect(moss.warnings.join(" ")).toContain("@artist");
  });

  it("moves the artist into Kaloscope parameters and out of every other pipeline", () => {
    const kaloscope = routeArtistTerms([artistTerm()], "kaloscope");
    expect(kaloscope.terms).toEqual([]);
    expect(kaloscope.routes[0].promptToken).toBeNull();
    expect(kaloscope.routes[0].injection).toMatchObject({
      artistName: "wlop",
      bank: "artist-v1.safetensors",
      styleGuidance: 6,
      adapterStrength: 1,
      baseModel: "MOSS-Image Base",
    });

    for (const pipeline of ["k2", "h3", "unknown"] as const) {
      const routed = routeArtistTerms([artistTerm()], pipeline);
      expect(routed.terms).toEqual([]);
      expect(routed.routes[0].promptToken).toBeNull();
      expect(routed.routes[0].injection).toBeNull();
    }
  });
});

describe("orchestrator entity integration", () => {
  it("adds a resolved name as a fixed identity field with provenance", async () => {
    const result = await new PromptOrchestrator({
      vocabulary,
      llm: stubLlm(captionJson("ganyu (genshin impact) in a garden")),
    }).orchestrate(
      expandInput({ prompt: "ganyu (genshin impact) in a garden" }),
    );
    expect(result.status).toBe("complete");
    expect(result.entityResolutions?.[0].status).toBe("resolved");
    expect(result.routePlan?.path).toBe("hybrid");
    expect(result.fields).toContainEqual(
      expect.objectContaining({
        name: "character",
        value: "ganyu (genshin impact)",
        layer: "fixed",
        source: "user",
        termId: "char-gen",
      }),
    );
  });

  it("keeps a Krea 2 artist out of selected terms and reports the route", async () => {
    const result = await new PromptOrchestrator({
      vocabulary,
      llm: stubLlm(captionJson("a quiet portrait")),
    }).orchestrate(
      expandInput({
        skill: "k2",
        prompt: "a quiet portrait",
        selectedTermIds: ["artist-at"],
      }),
    );
    expect(result.selectedTerms.map((term) => term.id)).not.toContain("artist-at");
    expect(result.artistRoutes?.[0]).toMatchObject({
      pipeline: "k2",
      artistName: "wlop",
      promptToken: null,
    });
    expect(result.warnings.join(" ")).toContain("artist names were kept out");
  });

  it("never auto-selects an artist from a prompt mention", async () => {
    const result = await new PromptOrchestrator({
      vocabulary,
      llm: stubLlm(captionJson("a painted portrait")),
    }).orchestrate(expandInput({ prompt: "a portrait in the style of wlop" }));
    expect(result.selectedTerms.filter((term) => term.category === "artist")).toEqual([]);
    expect(result.fields.filter((field) => field.name === "artist")).toEqual([]);
  });

  it("rejects an unsupported pipeline instead of silently guessing", async () => {
    await expect(
      new PromptOrchestrator({ vocabulary, llm: stubLlm(captionJson()) }).orchestrate(
        expandInput({ targetPipeline: "sdxl" as unknown as "anima" }),
      ),
    ).rejects.toThrow("Unsupported target pipeline");
  });
});

describe("dynamic polish entity path", () => {
  it("skips planning and retrieval when the input is only identities", async () => {
    const calls: string[] = [];
    const llm: PromptOrchestratorLlm = {
      complete: async (request) => {
        calls.push(request.messages.user);
        if (calls.length > 1) throw new Error("entity-only input must not plan a second call");
        return JSON.stringify({
          initialPrompt: "ganyu (genshin impact)",
          completePrompt: "ganyu (genshin impact)",
          fields: [],
          termDecisions: [
            {
              slotId: "identity",
              category: "character",
              sourceText: "ganyu (genshin impact)",
              strategy: "create",
              termIds: [],
              output: "ganyu (genshin impact)",
              rationale: "identity fixed by the input",
            },
          ],
        });
      },
    };
    const input = expandInput({
      mode: "polish",
      guidanceMode: "agent-led",
      prompt: "ganyu (genshin impact)",
    });
    expect(isDynamicPolish(input)).toBe(true);
    const result = await new PromptOrchestrator({ vocabulary, llm }).orchestrate(input);
    expect(calls).toHaveLength(1);
    expect(result.retrievalSummary).toEqual({ rounds: 0, queryCount: 0, candidateCount: 0 });
    expect(JSON.parse(calls[0]) as { retrievalPath?: string }).toMatchObject({
      retrievalPath: "entity-only",
      allowCreate: false,
    });
  });
});
