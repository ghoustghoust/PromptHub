/**
 * Real-query retrieval evaluation for the 91k isolated vocabulary database.
 *
 * Purpose: measure what the current lexical retrieval actually delivers on
 * real community data, so the Embedding / reranker decisions recorded in
 * spec/changes/active/prompt-orchestrator-assistant/polish-dynamic-retrieval-requirements.md
 * section 11 can be settled with evidence instead of speculation.
 *
 * Surfaces compared:
 * - Surface A: PromptVocabDB.searchTerms (SQLite LIKE, alphabetical order) —
 *   what the picker/browser and IPC search expose.
 * - Surface B: the dynamic-polish retriever groups the model actually receives
 *   (runDynamicPolish with a scripted LLM plan), i.e. ranked, deduplicated,
 *   budgeted candidates.
 *
 * The suite skips itself unless PROMPTHUB_EVAL_DB points at an isolated test
 * database; it never runs against a formal profile. It opens the database
 * read-only and performs no writes. Results are aggregated in memory and the
 * JSON report is written to PROMPTHUB_EVAL_OUT (OS temp default).
 *
 * Run from the repository root:
 *   $env:PROMPTHUB_EVAL_DB="<isolated prompthub.db>"
 *   $env:PROMPTHUB_EVAL_OUT="<report.json>"
 *   pnpm --dir packages/core exec vitest run tests/retrieval-evaluation.test.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseAdapter, PromptVocabDB } from "@prompthub/db";
import { runDynamicPolish } from "../src/prompt-orchestrator-dynamic-polish";
import type {
  PromptOrchestrationInput,
  PromptRetrievalSummary,
  PromptTerm,
  PromptTermDomain,
  PromptVocabularySearchInput,
} from "@prompthub/shared/types";
import type { PromptOrchestratorLlm } from "../src/prompt-orchestrator-llm";

/** Must mirror RETRIEVAL_CATEGORIES in prompt-orchestrator-dynamic-polish.ts. */
const RETRIEVAL_CATEGORIES = [
  "style",
  "base",
  "body",
  "face",
  "hair",
  "clothing",
  "accessory",
  "pose",
  "expression",
  "environment",
  "weather",
  "props",
  "lighting",
  "composition",
  "camera",
] as const;

const FORBIDDEN_CATEGORIES = ["artist", "character", "nsfw"] as const;

const dbPath = process.env.PROMPTHUB_EVAL_DB ?? "";

interface SampleEntry {
  term: PromptTerm;
  category: string;
}

interface RetrievedCandidate {
  id: string;
  en: string;
  template: string | null;
  relation?: string;
}

interface RetrievalGroup {
  slotId: string;
  status: string;
  truncated: boolean;
  candidates: RetrievedCandidate[];
}

interface DynamicResult {
  groups: RetrievalGroup[];
  planSystem: string;
  summary: PromptRetrievalSummary;
  warnings: string[];
}

interface ClassMetrics {
  queries: number;
  notes: string[];
  surfaceA?: Record<string, number>;
  surfaceB?: Record<string, number>;
  /** Distribution of the top candidate relation label for this query class. */
  relations?: Record<string, number>;
}

function countRelation(
  counts: Record<string, number>,
  group: RetrievalGroup | undefined,
): void {
  const relation = group?.candidates[0]?.relation;
  if (!relation) return;
  counts[relation] = (counts[relation] ?? 0) + 1;
}

let adapter: DatabaseAdapter.Database;
let vocabulary: PromptVocabDB;
const sample: SampleEntry[] = [];
const metrics: Record<string, ClassMetrics> = {};
const dbStats: Record<string, unknown> = {};

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[_/\\-]+/g, " ").trim();
}

function distinctiveWord(en: string): string | null {
  const words = en.split(/[^a-z0-9]+/i).filter((word) => word.length >= 5);
  return words.length > 0 ? words[Math.floor(words.length / 2)] : null;
}

/** Runs one dynamic-polish retrieval round per planned query and returns the model-visible groups. */
async function runDynamicRetrieval(
  planQueries: Array<{
    query: string;
    category: string;
    depth?: "exact" | "focused" | "exploratory";
    slotId?: string;
  }>,
  overrides: Partial<PromptOrchestrationInput> = {},
): Promise<DynamicResult> {
  const requests: Array<{ system: string; user: string }> = [];
  const llm: PromptOrchestratorLlm = {
    complete: async (request) => {
      requests.push({ system: request.messages.system, user: request.messages.user });
      if (requests.length === 1) {
        return JSON.stringify({
          queries: planQueries.map((entry) => ({
            slotId: entry.slotId ?? "eval",
            category: entry.category,
            query: entry.query,
            purpose: "compare",
            depth: entry.depth ?? "focused",
          })),
        });
      }
      return JSON.stringify({
        initialPrompt: "probe",
        completePrompt: "probed output",
        fields: [],
        termDecisions: [
          {
            slotId: "eval",
            category: "lighting",
            sourceText: "probe",
            strategy: "create",
            termIds: [],
            output: "probed output",
            rationale: "evaluation probe",
          },
        ],
      });
    },
  };
  const input: PromptOrchestrationInput = {
    prompt: "evaluation probe",
    mode: "polish",
    guidanceMode: "agent-led",
    outputFormat: "caption",
    ...overrides,
  };
  const result = await runDynamicPolish({
    input,
    vocabulary,
    llm,
    explicitTerms: [],
    modelDirectives: [],
  });
  // The composition request carries the retrieval groups the model would see.
  const compositionUser = JSON.parse(requests[1].user) as {
    retrieval?: RetrievalGroup[];
  };
  return {
    groups: compositionUser.retrieval ?? [],
    planSystem: requests[0].system,
    summary: result.retrievalSummary ?? { rounds: 0, queryCount: 0, candidateCount: 0 },
    warnings: result.warnings,
  };
}

function searchIds(query: string, overrides: Partial<PromptVocabularySearchInput> = {}): string[] {
  return vocabulary
    .searchTerms({ query, limit: 60, ...overrides })
    .map((item) => item.id);
}

function firstTermOfDomain(domain: PromptTermDomain): SampleEntry | null {
  for (const category of RETRIEVAL_CATEGORIES) {
    const terms = vocabulary.listTermsByCategory(category, undefined, undefined, domain);
    const term = terms.find(
      (entry) => entry.validationStatus !== "deprecated" && entry.domain === domain,
    );
    if (term) return { term, category };
  }
  return null;
}

describe.skipIf(!dbPath)("vocabulary retrieval evaluation (isolated db)", () => {
  beforeAll(() => {
    adapter = new DatabaseAdapter(dbPath, { readOnly: true });
    vocabulary = new PromptVocabDB(adapter);
    const seen = new Set<string>();
    for (const category of RETRIEVAL_CATEGORIES) {
      const terms = vocabulary
        .listTermsByCategory(category)
        .filter((term) => term.validationStatus !== "deprecated");
      const stride = Math.max(1, Math.floor(terms.length / 2));
      for (const index of [0, stride]) {
        const term = terms[index];
        if (!term || seen.has(term.id)) continue;
        seen.add(term.id);
        sample.push({ term, category });
      }
    }

    const allowedCounts: Record<string, number> = {};
    let allowedTotal = 0;
    let allowedDeprecated = 0;
    let allowedZhNull = 0;
    let allowedModelRestricted = 0;
    let allowedSeriesTagged = 0;
    const domainCounts: Record<string, number> = { shared: 0, anime: 0, real: 0, "3d": 0 };
    for (const category of [...RETRIEVAL_CATEGORIES, ...FORBIDDEN_CATEGORIES]) {
      const terms = vocabulary.listTermsByCategory(category);
      allowedCounts[category] = terms.length;
      if ((FORBIDDEN_CATEGORIES as readonly string[]).includes(category)) continue;
      for (const term of terms) {
        allowedTotal += 1;
        if (term.validationStatus === "deprecated") allowedDeprecated += 1;
        if (term.zh === null || term.zh.trim().length === 0) allowedZhNull += 1;
        if (term.applicableModels.length > 0) allowedModelRestricted += 1;
        if (term.series !== null && term.series.trim().length > 0) allowedSeriesTagged += 1;
        domainCounts[term.domain] = (domainCounts[term.domain] ?? 0) + 1;
      }
    }
    dbStats.rowCounts = allowedCounts;
    dbStats.allowedCategories = {
      total: allowedTotal,
      deprecated: allowedDeprecated,
      zhNull: allowedZhNull,
      modelRestricted: allowedModelRestricted,
      seriesTagged: allowedSeriesTagged,
      domainCounts,
    };
    dbStats.sampleSize = sample.length;
  });

  afterAll(() => {
    adapter.close();
    const report = {
      db: dbPath,
      dbStats,
      classes: metrics,
    };
    const outPath =
      process.env.PROMPTHUB_EVAL_OUT ?? path.join(os.tmpdir(), "prompthub-retrieval-eval.json");
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
    console.log(`[retrieval-eval] report written to ${outPath}`);
    for (const [name, entry] of Object.entries(metrics)) {
      console.log(
        `[retrieval-eval] ${name}: queries=${entry.queries} A=${JSON.stringify(entry.surfaceA ?? {})} B=${JSON.stringify(entry.surfaceB ?? {})}`,
      );
    }
  });

  it("ranks the exact English expression first for the model and keeps it in LIKE search", async () => {
    const expressionKey = (en: string, template: string | null) =>
      normalizeText(template?.trim() || en);
    let textRankFirst = 0;
    let idRankFirst = 0;
    let recallB6 = 0;
    let recallA6 = 0;
    let recallA60 = 0;
    const failures: string[] = [];
    const antonymTop6: string[] = [];
    const relations: Record<string, number> = {};
    for (const entry of sample) {
      const dynamic = await runDynamicRetrieval([
        { query: entry.term.en, category: entry.category, depth: "exact" },
      ]);
      const group = dynamic.groups[0];
      countRelation(relations, group);
      const expectedKey = expressionKey(entry.term.en, entry.term.template);
      const top = group?.candidates[0];
      const topKey = top ? expressionKey(top.en, top.template) : "";
      if (topKey === expectedKey) textRankFirst += 1;
      else failures.push(`${entry.term.id}:top=${top?.id ?? "none"}`);
      if (top?.id === entry.term.id) idRankFirst += 1;
      if (group?.candidates.slice(0, 6).some((candidate) => candidate.id === entry.term.id)) {
        recallB6 += 1;
      }
      const likeIds = searchIds(entry.term.en);
      if (likeIds.slice(0, 6).includes(entry.term.id)) recallA6 += 1;
      if (likeIds.includes(entry.term.id)) recallA60 += 1;
      if (entry.term.en.toLowerCase().includes("soft")) {
        const hasHard = (group?.candidates ?? [])
          .slice(0, 6)
          .some((candidate) => /\bhard\b/i.test(candidate.en));
        if (hasHard) antonymTop6.push(entry.term.en);
      }
    }
    metrics.exactEnglish = {
      queries: sample.length,
      surfaceB: { expressionRankFirst: textRankFirst, idRankFirst, recallAt6: recallB6 },
      surfaceA: { recallAt6: recallA6, recallAt60: recallA60 },
      relations,
      notes: [
        `antonymTermsInTop6:${antonymTop6.length}`,
        "identical expressions duplicated across import sources share rank 1 by normalized text; idRankFirst counts only the surviving deduplicated row",
        ...failures.slice(0, 10),
      ],
    };
    expect(textRankFirst).toBe(sample.length);
    expect(recallA60).toBe(sample.length);
  }, 300_000);

  it("recalls Chinese fragments on both surfaces", async () => {
    const zhSample: Array<SampleEntry & { zh: string }> = [];
    for (const entry of sample) {
      const zh = entry.term.zh;
      if (typeof zh === "string" && zh.trim().length >= 2) {
        zhSample.push({ ...entry, zh });
      }
    }
    let recallB6 = 0;
    let recallA6 = 0;
    const relations: Record<string, number> = {};
    for (const entry of zhSample) {
      const fragment = entry.zh.trim().slice(0, 4);
      const dynamic = await runDynamicRetrieval([{ query: fragment, category: entry.category }]);
      countRelation(relations, dynamic.groups[0]);
      if (
        (dynamic.groups[0]?.candidates ?? []).some((candidate) => candidate.id === entry.term.id)
      ) {
        recallB6 += 1;
      }
      if (searchIds(fragment).slice(0, 6).includes(entry.term.id)) recallA6 += 1;
    }
    metrics.chineseFragment = {
      queries: zhSample.length,
      surfaceB: { recallAt6: recallB6 },
      surfaceA: { recallAt6: recallA6 },
      relations,
      notes: [`zhCoverageInSample:${zhSample.length}/${sample.length}`],
    };
    expect(zhSample.length).toBeGreaterThan(0);
    expect(recallB6).toBeGreaterThan(0);
  }, 300_000);

  it("recalls single English word fragments", async () => {
    const probes: Array<{ entry: SampleEntry; word: string }> = [];
    for (const entry of sample) {
      const word = distinctiveWord(entry.term.en);
      if (word) probes.push({ entry, word });
    }
    let recallB6 = 0;
    let recallA6 = 0;
    const relations: Record<string, number> = {};
    for (const probe of probes) {
      const dynamic = await runDynamicRetrieval([
        { query: probe.word, category: probe.entry.category },
      ]);
      countRelation(relations, dynamic.groups[0]);
      if (
        (dynamic.groups[0]?.candidates ?? []).some(
          (candidate) => candidate.id === probe.entry.term.id,
        )
      ) {
        recallB6 += 1;
      }
      if (searchIds(probe.word).slice(0, 6).includes(probe.entry.term.id)) recallA6 += 1;
    }
    metrics.englishFragment = {
      queries: probes.length,
      surfaceB: { recallAt6: recallB6 },
      surfaceA: { recallAt6: recallA6 },
      relations,
      notes: [],
    };
    expect(probes.length).toBeGreaterThan(0);
    expect(recallB6).toBeGreaterThan(0);
  }, 300_000);

  it("returns empty results with explicit no-match status and warning", async () => {
    const dynamic = await runDynamicRetrieval([
      { query: "zzzqqqxwv", category: "lighting" },
    ]);
    expect(dynamic.groups[0]?.candidates).toEqual([]);
    expect(dynamic.groups[0]?.status).toBe("no_match");
    expect(dynamic.warnings.join(" ")).toContain(
      "No vocabulary candidates matched dynamic polish slot",
    );
    expect(vocabulary.searchTerms({ query: "zzzqqqxwv", limit: 60 })).toEqual([]);
    metrics.noMatch = { queries: 1, notes: ["empty-without-crash"] };
  }, 60_000);

  it("never retrieves artist, character or NSFW categories even when planned", async () => {
    for (const category of FORBIDDEN_CATEGORIES) {
      const dynamic = await runDynamicRetrieval([
        { query: "any appearance", category, depth: "exploratory" },
      ]);
      expect(dynamic.groups[0]?.candidates).toEqual([]);
      expect(dynamic.groups[0]?.status).toBe("no_match");
    }
    const probe = await runDynamicRetrieval([{ query: "soft light", category: "lighting" }]);
    expect(probe.planSystem).toContain("Do not query artist, character or NSFW");
    metrics.forbiddenCategories = {
      queries: FORBIDDEN_CATEGORIES.length,
      notes: ["zero-candidates-enforced-by-retriever"],
    };
  }, 120_000);

  it("ranks the exact short term above long sentences containing it", async () => {
    let probe: SampleEntry | null = null;
    let longCompetitors = 0;
    for (const entry of sample) {
      const word = distinctiveWord(entry.term.en);
      if (!word) continue;
      const pool = vocabulary
        .searchTerms({ query: word, limit: 5000 })
        .filter((item) => item.en.length > entry.term.en.length * 2);
      if (pool.length > 0) {
        probe = entry;
        longCompetitors = pool.length;
        break;
      }
    }
    if (!probe) {
      metrics.lengthBias = { queries: 0, notes: ["no-long-competitor-found-in-sample"] };
      return;
    }
    const dynamic = await runDynamicRetrieval([
      { query: probe.term.en, category: probe.category, depth: "exact" },
    ]);
    const top = dynamic.groups[0]?.candidates ?? [];
    expect(top[0]?.id).toBe(probe.term.id);
    metrics.lengthBias = {
      queries: 1,
      surfaceB: { rankFirst: top[0]?.id === probe.term.id ? 1 : 0 },
      notes: [
        `probe:${probe.term.en}`,
        `longCompetitorsInPool:${longCompetitors}`,
        `top3:${top.slice(0, 3).map((candidate) => candidate.en).join(" | ")}`,
      ],
    };
  }, 120_000);

  it("suppresses near-duplicate normalized texts before candidates reach the model", async () => {
    let dbDupVariants = 0;
    let modelVisibleDuplicates = 0;
    const normalize = (value: string) => normalizeText(value);
    for (const entry of sample) {
      const dynamic = await runDynamicRetrieval([
        { query: entry.term.en, category: entry.category, depth: "exploratory" },
      ]);
      const keys = (dynamic.groups[0]?.candidates ?? []).map((candidate) =>
        normalize(candidate.en),
      );
      if (new Set(keys).size !== keys.length) modelVisibleDuplicates += 1;
      const raw = vocabulary.searchTerms({ query: entry.term.en, limit: 60 });
      const rawKeys = raw.map((item) => normalize(item.en));
      if (rawKeys.length > 0 && new Set(rawKeys).size !== rawKeys.length) dbDupVariants += 1;
    }
    metrics.nearDuplicate = {
      queries: sample.length,
      notes: [
        `dbRowsWithNormalizedVariants:${dbDupVariants}`,
        `modelVisibleDuplicateGroups:${modelVisibleDuplicates}`,
      ],
    };
    expect(modelVisibleDuplicates).toBe(0);
  }, 300_000);

  it("routes domains: a specific domain includes shared terms and excludes other domains", async () => {
    const anime = firstTermOfDomain("anime");
    const real = firstTermOfDomain("real");
    const shared = firstTermOfDomain("shared");
    const notes: string[] = [];
    if (anime) {
      const viaAnime = await runDynamicRetrieval(
        [{ query: anime.term.en, category: anime.category, depth: "exact" }],
        { domain: "anime" },
      );
      expect(viaAnime.groups[0]?.candidates.some((c) => c.id === anime.term.id)).toBe(true);
      if (real) {
        const blocked = await runDynamicRetrieval(
          [{ query: real.term.en, category: real.category, depth: "exact" }],
          { domain: "anime" },
        );
        expect(
          blocked.groups[0]?.candidates.some((c) => c.id === real.term.id),
        ).toBe(false);
      }
      notes.push(`anime:${anime.term.id}`);
    }
    if (real) {
      const viaReal = await runDynamicRetrieval(
        [{ query: real.term.en, category: real.category, depth: "exact" }],
        { domain: "real" },
      );
      expect(viaReal.groups[0]?.candidates.some((c) => c.id === real.term.id)).toBe(true);
      notes.push(`real:${real.term.id}`);
    }
    if (shared) {
      const viaAnime = await runDynamicRetrieval(
        [{ query: shared.term.en, category: shared.category, depth: "exact" }],
        { domain: "anime" },
      );
      const viaReal = await runDynamicRetrieval(
        [{ query: shared.term.en, category: shared.category, depth: "exact" }],
        { domain: "real" },
      );
      expect(
        viaAnime.groups[0]?.candidates.some((c) => c.id === shared.term.id),
      ).toBe(true);
      expect(
        viaReal.groups[0]?.candidates.some((c) => c.id === shared.term.id),
      ).toBe(true);
      notes.push(`shared:${shared.term.id}`);
    }
    metrics.domainRouting = { queries: 3, notes };
  }, 180_000);

  it("respects model applicability and series filters when the corpus carries them", async () => {
    let modelTerm: SampleEntry | null = null;
    let seriesTerm: SampleEntry | null = null;
    for (const category of RETRIEVAL_CATEGORIES) {
      const terms = vocabulary.listTermsByCategory(category);
      if (!modelTerm) {
        const found = terms.find((term) => term.applicableModels.length > 0);
        if (found) modelTerm = { term: found, category };
      }
      if (!seriesTerm) {
        const found = terms.find(
          (term) => term.series !== null && term.series.trim().length > 0,
        );
        if (found) seriesTerm = { term: found, category };
      }
      if (modelTerm && seriesTerm) break;
    }
    const notes: string[] = [];
    if (modelTerm) {
      const allowed = await runDynamicRetrieval(
        [{ query: modelTerm.term.en, category: modelTerm.category, depth: "exact" }],
        { modelId: modelTerm.term.applicableModels[0] },
      );
      expect(
        allowed.groups[0]?.candidates.some((c) => c.id === modelTerm.term.id),
      ).toBe(true);
      const blocked = await runDynamicRetrieval(
        [{ query: modelTerm.term.en, category: modelTerm.category, depth: "exact" }],
        { modelId: "eval-other-model" },
      );
      expect(
        blocked.groups[0]?.candidates.some((c) => c.id === modelTerm.term.id),
      ).toBe(false);
      notes.push(`modelRouted:${modelTerm.term.id}`);
    } else {
      notes.push("no applicableModels-restricted term in retrieval categories");
    }
    if (seriesTerm && seriesTerm.term.series !== null) {
      const series = seriesTerm.term.series;
      const scoped = await runDynamicRetrieval(
        [{ query: seriesTerm.term.en, category: seriesTerm.category, depth: "exact" }],
        { series },
      );
      expect(scoped.groups[0]?.candidates.some((c) => c.id === seriesTerm.term.id)).toBe(true);
      const other = await runDynamicRetrieval(
        [{ query: seriesTerm.term.en, category: seriesTerm.category, depth: "exact" }],
        { series: "eval-unmatched-series" },
      );
      expect(other.groups[0]?.candidates.some((c) => c.id === seriesTerm.term.id)).toBe(false);
      notes.push(`seriesRouted:${seriesTerm.term.id}`);
    } else {
      notes.push("no series-tagged term in retrieval categories");
    }
    metrics.routing = { queries: 4, notes };
  }, 180_000);

  it("keeps per-slot candidate budgets fair and honors a zero budget", async () => {
    const lighting = sample.find((entry) => entry.category === "lighting") ?? sample[0];
    const camera = sample.find((entry) => entry.category === "camera") ?? sample[1] ?? sample[0];
    const fair = await runDynamicRetrieval(
      [
        { slotId: "eval-lighting", query: "light", category: lighting.category },
        { slotId: "eval-camera", query: "lens", category: camera.category },
      ],
      { vocabularyTokenBudget: 1200 },
    );
    expect(fair.groups).toHaveLength(2);
    expect((fair.groups[0]?.candidates ?? []).length).toBeGreaterThan(0);
    expect((fair.groups[1]?.candidates ?? []).length).toBeGreaterThan(0);

    const zero = await runDynamicRetrieval([{ query: "light", category: "lighting" }], {
      vocabularyTokenBudget: 0,
    });
    expect(zero.groups[0]?.candidates).toEqual([]);
    expect(zero.warnings.join(" ")).toContain(
      "Automatic vocabulary context budget is zero",
    );
    metrics.budgetFairness = {
      queries: 3,
      notes: [
        `lightingCandidates:${(fair.groups[0]?.candidates ?? []).length}`,
        `cameraCandidates:${(fair.groups[1]?.candidates ?? []).length}`,
        `zeroBudgetRounds:${zero.summary.rounds}`,
      ],
    };
  }, 180_000);
});
