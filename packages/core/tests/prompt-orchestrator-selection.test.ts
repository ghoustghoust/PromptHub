import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DatabaseAdapter,
  PromptVocabDB,
  SCHEMA_INDEXES,
  SCHEMA_TABLES,
} from "@prompthub/db";
import { PromptOrchestrator } from "../src/prompt-orchestrator";
import type { PromptOrchestratorLlm } from "../src/prompt-orchestrator-llm";

let database: DatabaseAdapter.Database;
let vocabulary: PromptVocabDB;

beforeEach(() => {
  database = new DatabaseAdapter(":memory:");
  database.exec(SCHEMA_TABLES);
  database.exec(SCHEMA_INDEXES);
  vocabulary = new PromptVocabDB(database);
  const lighting = [
    ["light-a", "golden hour", {}],
    ["light-b", "soft rim light", {}],
    ["light-c", "hard flash", { applicableModels: ["model-other"] }],
    ["light-d", "pool-a light", { series: "pool-a" }],
    ["light-e", "pool-b light", { series: "pool-b" }],
    ["light-f", "backlit", {}],
    ["light-g", "front lit", {}],
    ["light-h", "old glow", { validationStatus: "deprecated" }],
    ["light-i", "dim glow", { validationStatus: "unvalidated" }],
    ["excl-a", "excluded tone", {}],
  ] as const;
  for (const [id, en, overrides] of lighting) {
    vocabulary.addTerm({
      id,
      category: "lighting",
      en,
      validationStatus: "validated",
      createdAt: "2026-11-18T00:00:00.000Z",
      ...overrides,
    } as Parameters<PromptVocabDB["addTerm"]>[0]);
  }
  vocabulary.addTerm({
    id: "style-a",
    category: "style",
    en: "watercolor",
    validationStatus: "validated",
    createdAt: "2026-11-18T00:00:00.000Z",
  });
  vocabulary.addRelation("light-f", "light-g", "conflict");
});

afterEach(() => database.close());

function compositionJson(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    initialPrompt: "source",
    completePrompt: "composed output",
    fields: [],
    ...extra,
  });
}

function llmReturning(response: string): PromptOrchestratorLlm {
  return { complete: async () => response };
}

function randomTerms(): void {
  for (let index = 1; index <= 8; index += 1) {
    vocabulary.addTerm({
      id: `random-${index}`,
      category: "lighting",
      en: `random tone ${index}`,
      validationStatus: "validated",
      createdAt: "2026-11-18T00:00:00.000Z",
    });
  }
}

describe("PromptOrchestrator selection contracts", () => {
  it("filters automatic terms by model applicability and warns on explicit mismatches", async () => {
    const input = {
      prompt: "a study with golden hour and hard flash",
      mode: "expand" as const,
      categories: ["lighting"],
      candidateLimitPerCategory: 5,
    };
    const unrestricted = await new PromptOrchestrator({
      vocabulary,
      llm: llmReturning(compositionJson()),
    }).orchestrate(input);
    expect(unrestricted.status).toBe("complete");
    expect(unrestricted.selectedTerms.map((term) => term.id)).toContain("light-a");
    expect(unrestricted.selectedTerms.map((term) => term.id)).toContain("light-c");

    const filtered = await new PromptOrchestrator({
      vocabulary,
      llm: llmReturning(compositionJson()),
    }).orchestrate({ ...input, modelId: "model-main" });
    expect(filtered.selectedTerms.map((term) => term.id)).toContain("light-a");
    expect(filtered.selectedTerms.map((term) => term.id)).not.toContain("light-c");

    const explicitMismatch = await new PromptOrchestrator({
      vocabulary,
      llm: llmReturning(compositionJson()),
    }).orchestrate({
      ...input,
      modelId: "model-main",
      selectedTermIds: ["light-c"],
    });
    expect(
      explicitMismatch.selectedTerms.map((term) => term.id),
    ).not.toContain("light-c");
    expect(explicitMismatch.warnings.join(" ")).toContain(
      "Explicit term light-c was excluded",
    );
  });

  it("keeps series-unmatched terms out while null-series and category fallback stay eligible", async () => {
    const input = {
      prompt: "pool-a light pool-b light soft rim",
      mode: "expand" as const,
      categories: ["lighting"],
      candidateLimitPerCategory: 5,
    };
    const scoped = await new PromptOrchestrator({
      vocabulary,
      llm: llmReturning(compositionJson()),
    }).orchestrate({ ...input, series: "pool-a" });
    const ids = scoped.selectedTerms.map((term) => term.id);
    expect(ids).toContain("light-d");
    expect(ids).toContain("light-b");
    expect(ids).not.toContain("light-e");

    const fallback = await new PromptOrchestrator({
      vocabulary,
      llm: llmReturning(compositionJson()),
    }).orchestrate({ ...input, series: "lighting" });
    const fallbackIds = fallback.selectedTerms.map((term) => term.id);
    expect(fallbackIds).toContain("light-e");
    expect(fallbackIds).toContain("light-d");
  });

  it("excludes conflicting automatic candidates and records the reason", async () => {
    const result = await new PromptOrchestrator({
      vocabulary,
      llm: llmReturning(compositionJson()),
    }).orchestrate({
      prompt: "backlit front lit",
      mode: "expand",
      categories: ["lighting"],
      candidateLimitPerCategory: 2,
    });
    expect(result.selectedTerms.map((term) => term.id)).toEqual(["light-g"]);
    expect(result.warnings.join(" ")).toContain(
      "Term light-f was excluded because it conflicts with light-g",
    );
  });

  it("keeps controlled-random selection deterministic for the same seed", async () => {
    randomTerms();
    const run = async (seed: string) => {
      const result = await new PromptOrchestrator({
        vocabulary,
        llm: llmReturning(compositionJson()),
      }).orchestrate({
        prompt: "a rooftop study",
        mode: "random",
        random: { subject: "girl", setting: "rooftop", seed },
        candidateLimitPerCategory: 3,
      });
      return result;
    };
    const first = await run("seed-alpha");
    const repeat = await run("seed-alpha");
    expect(first.status).toBe("complete");
    expect(first.selectedTerms.map((term) => term.id)).toEqual(
      repeat.selectedTerms.map((term) => term.id),
    );
    expect(first.selectedTerms.map((term) => term.selectionReason)).toEqual(
      Array.from({ length: first.selectedTerms.length }).fill("random"),
    );
    const otherSeed = await run("seed-beta");
    expect(otherSeed.selectedTerms.map((term) => term.id)).toEqual(
      otherSeed.selectedTerms.map((term) => term.id),
    );
    const fixed = first.fields.filter(
      (field) => field.name === "randomSubject" || field.name === "randomSetting",
    );
    expect(fixed.map((field) => field.layer)).toEqual(["fixed", "fixed"]);
    expect(fixed.map((field) => field.source)).toEqual(["user", "user"]);
  });

  it("builds fixed provenance from user facts and explicit terms, dropping LLM fields that cite selected terms", async () => {
    const result = await new PromptOrchestrator({
      vocabulary,
      llm: llmReturning(
        compositionJson({
          fields: [
            {
              name: "medium",
              value: "watercolor",
              layer: "fixed",
              termId: "style-a",
            },
            {
              name: "lighting",
              value: "golden hour",
              layer: "fixed",
              termId: "light-a",
            },
            { name: "vibe", value: "quiet", layer: "flexible" },
          ],
        }),
      ),
    }).orchestrate({
      prompt: "a ceramic vase with watercolor style and golden hour light",
      mode: "expand",
      fixedDetails: ["hand-painted texture"],
      constraints: ["no text"],
      selectedTermIds: ["style-a"],
      categories: ["style", "lighting"],
      candidateLimitPerCategory: 2,
    });
    expect(result.status).toBe("complete");
    const fixedDetail = result.fields.find(
      (field) => field.name === "fixedDetail",
    );
    expect(fixedDetail?.layer).toBe("fixed");
    expect(fixedDetail?.source).toBe("user");
    expect(fixedDetail?.value).toBe("hand-painted texture");
    const explicit = result.fields.find((field) => field.termId === "style-a");
    expect(explicit?.layer).toBe("fixed");
    expect(explicit?.source).toBe("vocabulary");
    const automatic = result.fields.find((field) => field.termId === "light-a");
    expect(automatic?.layer).toBe("flexible");
    expect(automatic?.source).toBe("vocabulary");
    expect(
      result.fields.filter((field) => field.source === "llm" && field.termId),
    ).toEqual([]);
  });

  it("degrades caption composition to a deterministic fallback preserving fixed facts", async () => {
    const result = await new PromptOrchestrator({
      vocabulary,
      llm: llmReturning("I cannot produce JSON today"),
    }).orchestrate({
      prompt: "a quiet study with golden hour light",
      mode: "expand",
      fixedDetails: ["hand-painted texture"],
      categories: ["lighting"],
      candidateLimitPerCategory: 2,
    });
    expect(result.status).toBe("degraded");
    expect(result.completePrompt).toContain("a quiet study with golden hour light");
    expect(result.completePrompt).toContain("hand-painted texture");
    expect(result.completePrompt).toContain("golden hour");
    expect(result.warnings.join(" ")).toContain(
      "LLM composition failed; deterministic fallback used",
    );
    expect(result.selectedTerms.map((term) => term.id)).toContain("light-a");
  });

  it("rejects unsupported domain, out-of-range budgets and invalid modes or skills", async () => {
    const orchestrator = new PromptOrchestrator({
      vocabulary,
      llm: llmReturning(compositionJson()),
    });
    const base = { prompt: "a study", mode: "expand" as const };
    // Invalid-enum literals are black-box boundary inputs; the runtime contract
    // must reject them, so the literals bypass the input TypeScript unions.
    await expect(
      orchestrator.orchestrate({ ...base, domain: "cartoon" as never }),
    ).rejects.toThrow(/Unsupported vocabulary domain/);
    await expect(
      orchestrator.orchestrate({ ...base, vocabularyTokenBudget: 5000 }),
    ).rejects.toThrow(/0 to 4000/);
    await expect(
      orchestrator.orchestrate({ ...base, candidateLimitPerCategory: 13 }),
    ).rejects.toThrow(/0 to 12/);
    await expect(
      orchestrator.orchestrate({ ...base, mode: "teleport" as never }),
    ).rejects.toThrow(/Unsupported orchestration mode/);
    await expect(
      orchestrator.orchestrate({ ...base, skill: "unknown-skill" as never }),
    ).rejects.toThrow(/Unsupported prompt rule skill/);
  });

  it("enforces mode-specific requirements before composition", async () => {
    const orchestrator = new PromptOrchestrator({
      vocabulary,
      llm: llmReturning(compositionJson()),
    });
    await expect(
      orchestrator.orchestrate({ mode: "reverse" }),
    ).rejects.toThrow(/prompt text or at least one reference image/);
    await expect(
      orchestrator.orchestrate({ mode: "lora", prompt: "a study" }),
    ).rejects.toThrow(/loraIds/);
    await expect(
      orchestrator.orchestrate({
        mode: "video-text",
        skill: "moss",
        outputFormat: "h3",
        prompt: "a cook lifts noodles",
      }),
    ).rejects.toThrow(/MiniMax-H3 rule card/);
    await expect(
      orchestrator.orchestrate({ mode: "expand", skill: "minimaxH3", prompt: "a study" }),
    ).rejects.toThrow(/only available for video/);
    await expect(
      orchestrator.orchestrate({ mode: "edit", prompt: "a study" }),
    ).rejects.toThrow(/editInstruction/);
    await expect(
      orchestrator.orchestrate({ mode: "polish", prompt: "   " }),
    ).rejects.toThrow(/prompt must be a non-empty string/);
  });

  it("excludes deprecated, explicitly excluded and unvalidated terms per policy", async () => {
    const input = {
      prompt: "golden hour old glow excluded tone dim glow",
      mode: "expand" as const,
      categories: ["lighting"],
      candidateLimitPerCategory: 5,
    };
    const base = await new PromptOrchestrator({
      vocabulary,
      llm: llmReturning(compositionJson()),
    }).orchestrate(input);
    expect(base.selectedTerms.map((term) => term.id)).not.toContain("light-h");

    const excluded = await new PromptOrchestrator({
      vocabulary,
      llm: llmReturning(compositionJson()),
    }).orchestrate({ ...input, excludedTermIds: ["light-a"] });
    expect(excluded.selectedTerms.map((term) => term.id)).not.toContain("light-a");

    const validatedOnly = await new PromptOrchestrator({
      vocabulary,
      llm: llmReturning(compositionJson()),
    }).orchestrate({ ...input, validatedOnly: true });
    expect(validatedOnly.selectedTerms.map((term) => term.id)).not.toContain(
      "light-i",
    );
  });

  it("disables automatic additions in human-led expand without explicit terms", async () => {
    const result = await new PromptOrchestrator({
      vocabulary,
      llm: llmReturning(compositionJson()),
    }).orchestrate({
      prompt: "a study with golden hour light",
      mode: "expand",
      guidanceMode: "human-led",
      categories: ["lighting"],
    });
    expect(result.selectedTerms).toEqual([]);
    expect(result.warnings.join(" ")).toContain(
      "No compatible vocabulary terms were selected",
    );
  });

  it("treats reference terms as optional material and lets exclusion win", async () => {
    const payloads: string[] = [];
    const llm: PromptOrchestratorLlm = {
      complete: async (request) => {
        payloads.push(request.messages.user);
        return compositionJson();
      },
    };
    const result = await new PromptOrchestrator({ vocabulary, llm }).orchestrate({
      prompt: "a quiet study",
      mode: "polish",
      guidanceMode: "human-led",
      categories: [],
      candidateLimitPerCategory: 0,
      lockedTermIds: ["light-a"],
      selectedTermIds: ["light-b"],
      referenceTermIds: ["style-a", "light-a"],
      excludedTermIds: ["excl-a"],
    });

    const payload = JSON.parse(payloads[0]) as {
      vocabulary: Array<{ id: string }>;
      referenceVocabulary: Array<{ id: string }>;
      excludedTermIds: string[];
    };
    // Locked/recommended terms keep their state; a term listed twice is resolved once.
    expect(payload.vocabulary.map((term) => term.id)).toEqual(["light-a", "light-b"]);
    expect(payload.referenceVocabulary.map((term) => term.id)).toEqual(["style-a"]);
    expect(payload.excludedTermIds).toEqual(["excl-a"]);

    const fixedTermIds = result.fields
      .filter((field) => field.layer === "fixed" && field.source === "vocabulary")
      .map((field) => field.termId);
    expect(fixedTermIds).toEqual(["light-a", "light-b"]);
    // Reference material is offered to the model but never injected as a fixed fact.
    expect(result.selectedTerms.find((term) => term.id === "style-a")?.selectionReason)
      .toBe("reference");
  });

  it("drops an explicit term that the user also excluded", async () => {
    const result = await new PromptOrchestrator({
      vocabulary,
      llm: llmReturning(compositionJson()),
    }).orchestrate({
      prompt: "a quiet study",
      mode: "polish",
      guidanceMode: "human-led",
      categories: [],
      candidateLimitPerCategory: 0,
      selectedTermIds: ["light-b"],
      excludedTermIds: ["light-b"],
    });
    expect(result.selectedTerms.map((term) => term.id)).not.toContain("light-b");
    expect(result.warnings.join(" ")).toContain(
      "was ignored because the user excluded it",
    );
  });

  it("downgrades an LLM fixed field that has no vocabulary termId", async () => {
    const result = await new PromptOrchestrator({
      vocabulary,
      llm: llmReturning(
        compositionJson({
          fields: [
            { name: "vibe", value: "quiet", layer: "fixed" },
            { name: "medium", value: "watercolor", layer: "fixed", termId: "style-a" },
          ],
        }),
      ),
    }).orchestrate({
      prompt: "a quiet study in watercolor",
      mode: "expand",
      categories: [],
      candidateLimitPerCategory: 0,
    });

    const unlinked = result.fields.find((field) => field.name === "vibe");
    expect(unlinked?.layer).toBe("flexible");
    expect(unlinked?.rationale).toContain("Downgraded from fixed");
    // A linked id is still allowed to carry the fixed layer.
    const linked = result.fields.find((field) => field.name === "medium");
    expect(linked?.layer).toBe("fixed");
    expect(linked?.termId).toBe("style-a");
  });
});
