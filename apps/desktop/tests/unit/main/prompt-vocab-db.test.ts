import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PromptVocabDB, migratePromptVocabSchema } from "@prompthub/db";
import {
  SCHEMA_INDEXES,
  SCHEMA_TABLES,
} from "../../../src/main/database/schema";
import DatabaseAdapter from "../../../src/main/database/sqlite";

describe("PromptVocabDB (in-memory SQLite)", () => {
  let rawDb: DatabaseAdapter.Database;
  let db: PromptVocabDB;

  beforeEach(() => {
    rawDb = new DatabaseAdapter(":memory:");
    rawDb.pragma("foreign_keys = ON");
    rawDb.exec(SCHEMA_TABLES);
    rawDb.exec(SCHEMA_INDEXES);
    db = new PromptVocabDB(rawDb);
  });

  afterEach(() => {
    rawDb.close();
  });

  function addTerm(
    overrides: {
      id?: string;
      category?: string;
      en?: string;
      zh?: string | null;
      applicableModels?: string[];
      series?: string;
      subcategory?: string;
      domain?: "shared" | "anime" | "real" | "3d";
    } = {},
  ) {
    return db.addTerm({
      category: overrides.category ?? "style",
      en: overrides.en ?? "watercolor",
      zh: overrides.zh ?? null,
      ...(overrides.subcategory === undefined ? {} : { subcategory: overrides.subcategory }),
      applicableModels: overrides.applicableModels ?? [],
      ...(overrides.id === undefined ? {} : { id: overrides.id }),
      ...(overrides.series === undefined ? {} : { series: overrides.series }),
      ...(overrides.domain === undefined ? {} : { domain: overrides.domain }),
    });
  }

  it("creates all prompt vocab tables", () => {
    const rows = rawDb.all(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('prompt_terms', 'term_relations', 'model_profiles', 'validation_records', 'source_assets')",
    ) as { name: string }[];
    expect(rows.map((row) => row.name).sort()).toEqual([
      "model_profiles",
      "prompt_terms",
      "source_assets",
      "term_relations",
      "validation_records",
    ]);
  });

  it("adds a term with defaults and round-trips every field", () => {
    const created = db.addTerm({
      category: "style",
      en: "watercolor",
      zh: "水彩风格",
    });
    expect(created.id).toBeTruthy();
    expect(created.validationStatus).toBe("unvalidated");
    expect(created.applicableModels).toEqual([]);
    expect(created.source).toBeNull();
    expect(db.getTerm(created.id)).toEqual(created);
    expect(db.getTerm("missing-term")).toBeNull();

    const full = db.addTerm({
      id: "term-full",
      category: "camera",
      subcategory: "angle",
      en: "from above",
      zh: "俯视",
      function: "camera angle control",
      applicableTask: "portrait",
      applicableModels: ["anima", "pony"],
      source: "manual",
      validationStatus: "validated",
      createdAt: "2026-05-09T00:00:00.000Z",
    });
    expect(db.getTerm("term-full")).toEqual(full);
    expect(full).toEqual(
      expect.objectContaining({
        subcategory: "angle",
        function: "camera angle control",
        applicableTask: "portrait",
        applicableModels: ["anima", "pony"],
        validationStatus: "validated",
        createdAt: "2026-05-09T00:00:00.000Z",
      }),
    );
  });

  it("rejects invalid term input and enforces the status CHECK", () => {
    expect(() => db.addTerm({ category: "style", en: "" })).toThrow();
    expect(() => db.addTerm({ category: "", en: "x" })).toThrow();
    expect(() =>
      db.addTerm({ category: "style", en: "x", zh: "bad\0zh" }),
    ).toThrow();
    expect(() =>
      rawDb.run(
        "INSERT INTO prompt_terms (id, category, en, validation_status, created_at) VALUES ('bad-status', 'style', 'x', 'bogus', 0)",
      ),
    ).toThrow();
  });

  it("lists terms by category and filters by applicable models", () => {
    addTerm({ en: "watercolor", applicableModels: [] });
    addTerm({ en: "score_9", applicableModels: ["anima"] });
    addTerm({ en: "pony_tag", applicableModels: ["pony"] });
    addTerm({ category: "lighting", en: "soft light" });

    expect(
      db.listTermsByCategory("style").map((term) => term.en),
    ).toEqual(["pony_tag", "score_9", "watercolor"]);
    expect(
      db.listTermsByCategory("style", "anima").map((term) => term.en),
    ).toEqual(["score_9", "watercolor"]);
    expect(
      db.listTermsByCategory("style", "unknown-model").map((term) => term.en),
    ).toEqual(["watercolor"]);
    expect(db.listTermsByCategory("lighting")).toHaveLength(1);
    expect(db.listTermsByCategory("missing-category")).toEqual([]);
  });

  it("resolves curated collection terms across import spellings", () => {
    addTerm({ en: "blender \\(medium\\)", zh: "3D 渲染" });
    addTerm({ en: "cel_shading", zh: "赛璐璐阴影" });
    addTerm({ en: "glowing neon lights", zh: "霓虹灯" });
    addTerm({ en: "deprecated tag" });
    rawDb.prepare("UPDATE prompt_terms SET validation_status = 'deprecated' WHERE en = ?").run(
      "deprecated tag",
    );

    const rows = db.resolveTerms(["Blender (medium)", "cel shading", "glowing neon lights", "deprecated tag", "missing"]);
    expect(rows.map((row) => row.en).sort()).toEqual([
      "blender \\(medium\\)",
      "cel_shading",
      "glowing neon lights",
    ]);

    expect(db.resolveTerms(["  CEL   SHADING  "]).map((row) => row.en)).toEqual(["cel_shading"]);
    expect(db.resolveTerms(["missing"])).toEqual([]);
  });

  it("validates resolve input bounds", () => {
    expect(() => db.resolveTerms([])).toThrow(/1 to 500/);
    expect(() => db.resolveTerms(Array.from({ length: 501 }, (_, index) => `term ${index}`))).toThrow(
      /1 to 500/,
    );
    expect(() => db.resolveTerms(["  "])).toThrow(/non-empty/);
  });

  it("defaults terms to shared and filters by subject domain", () => {
    const shared = addTerm({ category: "hair", en: "auburn hair" });
    addTerm({ category: "style", en: "cel shading", domain: "anime" });
    addTerm({ category: "style", en: "photorealistic", domain: "real" });
    addTerm({ category: "camera", en: "3d render", domain: "3d" });

    expect(shared.domain).toBe("shared");
    const names = (input: Parameters<typeof db.searchTerms>[0]) =>
      db.searchTerms(input).map((term) => term.en).sort();

    // A specific domain also offers descriptors every subject can use.
    expect(names({ domain: "anime" })).toEqual(["auburn hair", "cel shading"]);
    expect(names({ domain: "real" })).toEqual(["auburn hair", "photorealistic"]);
    expect(names({ domain: "shared" })).toEqual(["auburn hair"]);
    expect(names({})).toEqual(["3d render", "auburn hair", "cel shading", "photorealistic"]);
    expect(() => addTerm({ category: "style", en: "bad", domain: "cartoon" as never })).toThrow(
      /Unsupported term domain/,
    );
  });

  it("pages beyond 5000 with exact totals, facets and translation filters", () => {
    const insert = rawDb.prepare(
      `INSERT INTO prompt_terms (
        id, category, subcategory, en, zh, source, domain, validation_status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'unvalidated', 0)`,
    );
    rawDb.transaction(() => {
      for (let index = 0; index < 5002; index += 1) {
        insert.run(
          `bulk-${index}`,
          "character",
          index === 5001 ? "其他" : "主角",
          `bulk ${String(index).padStart(4, "0")}`,
          index % 2 === 0 ? "中文" : null,
          "fixture",
          "anime",
        );
      }
    })();

    const page = db.browseTerms({ category: "character", limit: 60, offset: 4980 });
    expect(page.total).toBe(5002);
    expect(page.items.map((term) => term.en)).toEqual([
      ...Array.from({ length: 22 }, (_, index) => `bulk ${String(index + 4980).padStart(4, "0")}`),
    ]);
    expect(page.categories).toEqual([{ category: "character", count: 5002 }]);
    expect(page.subcategories).toHaveLength(2);
    expect(page.subcategories).toEqual(expect.arrayContaining([
      { subcategory: "主角", count: 5001 },
      { subcategory: "其他", count: 1 },
    ]));
    expect(page.missingTranslation).toBe(2501);

    const scoped = db.browseTerms({
      category: "character",
      subcategory: "其他",
      translation: "missing",
      limit: 60,
    });
    expect(scoped.total).toBe(1);
    expect(scoped.items.map((term) => term.id)).toEqual(["bulk-5001"]);
    expect(scoped.missingTranslation).toBe(2501);
  });

  it("validates vocabulary browse pages and subcategory input", () => {
    addTerm({ category: "style", en: "watercolor", subcategory: "媒介" });
    expect(() => db.browseTerms({ limit: 0 })).toThrow(/1 to 200/);
    expect(() => db.browseTerms({ limit: 201 })).toThrow(/1 to 200/);
    expect(() => db.browseTerms({ offset: -1 })).toThrow(/non-negative/);
    expect(() => db.browseTerms({ subcategory: "bad\0value" })).toThrow(/null byte/);
    expect(db.browseTerms({ category: "style", subcategory: "", limit: 60 }).total).toBe(0);
    expect(db.browseTerms({ category: "style", subcategory: "媒介", limit: 60 }).total).toBe(1);
  });

  it("returns the domain from exact collection resolves", () => {
    addTerm({ category: "style", en: "photorealistic", domain: "real" });
    addTerm({ category: "pose", en: "low-angle selfie" });
    const rows = db.resolveTerms(["photorealistic", "low-angle selfie"]);
    expect(Object.fromEntries(rows.map((term) => [term.en, term.domain]))).toEqual({
      photorealistic: "real",
      "low-angle selfie": "shared",
    });
  });

  it("adds the domain column to databases created before it existed", () => {
    const legacy = new DatabaseAdapter(":memory:");
    legacy.exec(
      `CREATE TABLE prompt_terms (
         id TEXT PRIMARY KEY,
         category TEXT NOT NULL,
         subcategory TEXT,
         en TEXT NOT NULL,
         zh TEXT,
         series TEXT,
         template TEXT,
         "function" TEXT,
         applicable_task TEXT,
         applicable_models TEXT,
         source TEXT,
         validation_status TEXT NOT NULL DEFAULT 'unvalidated',
         created_at INTEGER NOT NULL
       )`,
    );
    legacy.prepare(
      `INSERT INTO prompt_terms (id, category, en, created_at) VALUES ('old', 'style', 'watercolor', 1)`,
    ).run();
    migratePromptVocabSchema(legacy);
    expect(legacy.prepare("SELECT domain FROM prompt_terms WHERE id = 'old'").get()).toEqual({
      domain: "shared",
    });
    legacy.close();
  });

  it("derives series options from categories when no series metadata exists", () => {
    addTerm({ category: "style", en: "watercolor" });
    addTerm({ category: "lighting", en: "soft light" });
    expect(db.listSeries()).toEqual(["lighting", "style"]);
    expect(
      db
        .listTermsByCategory("style", undefined, "style")
        .map((term) => term.en),
    ).toEqual(["watercolor"]);

    addTerm({ category: "style", en: "ink", series: "portrait-pack" });
    expect(db.listSeries()).toEqual(["portrait-pack"]);
    expect(
      db
        .listTermsByCategory("style", undefined, "portrait-pack")
        .map((term) => term.en),
    ).toEqual(["ink", "watercolor"]);
  });

  it("stores relations idempotently and resolves conflicts in both directions", () => {
    const a = addTerm({ id: "term-a", en: "term a" });
    const b = addTerm({ id: "term-b", en: "term b" });
    const c = addTerm({ id: "term-c", en: "term c" });

    db.addRelation(a.id, b.id, "conflict");
    db.addRelation(c.id, a.id, "conflict");
    db.addRelation(a.id, b.id, "synonym");
    db.addRelation(a.id, b.id, "conflict");

    expect(db.getConflicts(a.id)).toEqual([b.id, c.id]);
    expect(db.getConflicts(b.id)).toEqual([a.id]);
    expect(db.getConflicts(c.id)).toEqual([a.id]);
    const count = rawDb.get(
      "SELECT COUNT(*) AS count FROM term_relations",
    ) as { count: number };
    expect(count.count).toBe(3);
  });

  it("rejects self-relations, unknown terms, and invalid relation types", () => {
    const a = addTerm({ id: "term-a", en: "term a" });
    expect(() => db.addRelation(a.id, a.id, "conflict")).toThrow();
    expect(() => db.addRelation(a.id, "missing-term", "conflict")).toThrow();
    expect(() =>
      rawDb.run(
        "INSERT INTO term_relations (term_id, related_id, relation_type) VALUES (?, ?, 'bogus')",
        a.id,
        a.id,
      ),
    ).toThrow();
  });

  it("cascades term deletion into relations and validation records", () => {
    const a = addTerm({ id: "term-a", en: "term a" });
    const b = addTerm({ id: "term-b", en: "term b" });
    db.addRelation(a.id, b.id, "conflict");
    db.addValidation({ termId: a.id, outcome: "good" });

    rawDb.run("DELETE FROM prompt_terms WHERE id = ?", a.id);

    expect(db.getConflicts(b.id)).toEqual([]);
    expect(db.listValidation(a.id)).toEqual([]);
  });

  it("round-trips model profiles and enforces the kind CHECK", () => {
    const profile = db.addModelProfile({
      id: "anima",
      name: "Anima",
      kind: "base",
      triggerWords: ["anime", "illustration"],
      weightRange: "0.6-1.0",
      notes: "base checkpoint",
    });
    expect(db.getModelProfile("anima")).toEqual(profile);
    expect(profile.triggerWords).toEqual(["anime", "illustration"]);

    const lora = db.addModelProfile({ name: "Detail LoRA", kind: "lora" });
    expect(lora.id).toBeTruthy();
    expect(db.getModelProfile(lora.id)).toEqual(
      expect.objectContaining({ kind: "lora", triggerWords: [] }),
    );
    expect(db.getModelProfile("missing-model")).toBeNull();
    expect(() =>
      rawDb.run(
        "INSERT INTO model_profiles (id, name, kind) VALUES ('bad-kind', 'X', 'bogus')",
      ),
    ).toThrow();
  });

  it("records validations with params and lists them newest first", () => {
    const term = addTerm({ id: "term-a", en: "term a" });
    const first = db.addValidation({
      termId: term.id,
      modelId: "anima",
      params: { cfg: 7, steps: 28 },
      outcome: "good",
      notes: "clean render",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(first.id).toBeGreaterThan(0);
    db.addValidation({
      termId: term.id,
      outcome: "bad",
      createdAt: "2026-01-03T00:00:00.000Z",
    });
    db.addValidation({
      termId: term.id,
      outcome: "neutral",
      createdAt: "2026-01-02T00:00:00.000Z",
    });

    const records = db.listValidation(term.id);
    expect(records.map((record) => record.outcome)).toEqual([
      "bad",
      "neutral",
      "good",
    ]);
    expect(records[2]).toEqual(first);
    expect(records[2].params).toEqual({ cfg: 7, steps: 28 });
    expect(records[0].params).toBeNull();
    expect(db.listValidation("missing-term")).toEqual([]);
    expect(() => db.addValidation({ termId: "missing-term", outcome: "good" })).toThrow();
    expect(() =>
      rawDb.run(
        "INSERT INTO validation_records (term_id, outcome, created_at) VALUES (?, 'bogus', 0)",
        term.id,
      ),
    ).toThrow();
  });

  it("imports kb.json pools, characters, and assets with counts", () => {
    const kb = {
      schema_version: 1,
      field_pools: {
        style: {
          name: "质量与风格",
          tags: [
            { en: "watercolor", zh: "水彩风格" },
            { en: "oil painting", zh: "油画风格" },
          ],
        },
        lighting: { name: "光照", tags: [{ en: "soft light", zh: "柔光" }] },
      },
      characters: [
        {
          game: "宝可梦",
          game_tag: "pokemon",
          name: "Pikachu",
          tag: "pikachu",
          zh: "Pikachu（宝可梦）",
          auto_tags: ["pokemon (creature)"],
        },
      ],
      assets: [
        {
          id: "asset-1",
          prompt: "Positive prompt: watercolor landscape",
          style: "mosa",
          category: "landscape",
          rating: 5,
          preview_path: "previews/asset-1.png",
          original_path: "originals/asset-1.png",
          media_kind: "image",
        },
      ],
    };

    expect(db.importFromKbJson(kb)).toEqual({
      terms: 3,
      characters: 1,
      assets: 1,
      skipped: 0,
    });

    const styleTerms = db.listTermsByCategory("style");
    expect(styleTerms.map((term) => term.en)).toEqual([
      "oil painting",
      "watercolor",
    ]);
    expect(styleTerms[1]).toEqual(
      expect.objectContaining({
        zh: "水彩风格",
        validationStatus: "unvalidated",
        source: "prompt-forge-html",
      }),
    );
    expect(db.listTermsByCategory("lighting")).toHaveLength(1);

    const asset = rawDb.get(
      "SELECT kind, path, meta FROM source_assets WHERE id = ?",
      "asset-1",
    ) as { kind: string; path: string; meta: string };
    expect(asset.kind).toBe("mosa");
    expect(asset.path).toBe("previews/asset-1.png");
    const assetMeta = JSON.parse(asset.meta) as Record<string, unknown>;
    expect(assetMeta.prompt).toBe("Positive prompt: watercolor landscape");
    expect(assetMeta.style).toBe("mosa");

    const character = rawDb.get(
      "SELECT kind, title, meta FROM source_assets WHERE id = ?",
      "character:pokemon:pikachu",
    ) as { kind: string; title: string; meta: string };
    expect(character.kind).toBe("character");
    expect(character.title).toBe("Pikachu");
    const characterMeta = JSON.parse(character.meta) as Record<string, unknown>;
    expect(characterMeta.game_tag).toBe("pokemon");
    expect(characterMeta.auto_tags).toEqual(["pokemon (creature)"]);
  });

  it("re-imports the same kb.json without duplicating rows", () => {
    const kb = {
      field_pools: {
        style: {
          tags: [
            { en: "watercolor", zh: "水彩风格" },
            { en: "watercolor", zh: "重复标签" },
          ],
        },
      },
      characters: [{ game_tag: "pokemon", name: "Pikachu", tag: "pikachu" }],
      assets: [{ id: "asset-1", prompt: "p", style: "s" }],
    };

    expect(db.importFromKbJson(kb)).toEqual({
      terms: 1,
      characters: 1,
      assets: 1,
      skipped: 0,
    });
    expect(db.importFromKbJson(kb)).toEqual({
      terms: 0,
      characters: 0,
      assets: 0,
      skipped: 0,
    });
    const counts = rawDb.get(
      "SELECT (SELECT COUNT(*) FROM prompt_terms) AS terms, (SELECT COUNT(*) FROM source_assets) AS assets",
    ) as { terms: number; assets: number };
    expect(counts).toEqual({ terms: 1, assets: 2 });
  });

  it("skips malformed kb entries and rejects an invalid kb root", () => {
    const kb = {
      field_pools: {
        style: {
          tags: [
            { en: "ok" },
            { en: "" },
            { zh: "missing en" },
            { en: "bad\0tag" },
            "not-an-object",
          ],
        },
        broken: { tags: "not-an-array" },
      },
      characters: [{ name: "" }, { game_tag: "pokemon", tag: "pikachu" }],
      assets: [{ prompt: "missing id" }, { id: "asset-ok" }],
    };
    expect(db.importFromKbJson(kb)).toEqual({
      terms: 1,
      characters: 1,
      assets: 1,
      skipped: 7,
    });

    expect(() => db.importFromKbJson(null)).toThrow();
    expect(() => db.importFromKbJson([])).toThrow();
    expect(() => db.importFromKbJson({ field_pools: [] })).toThrow();
    expect(() => db.importFromKbJson({ characters: {} })).toThrow();
  });
});