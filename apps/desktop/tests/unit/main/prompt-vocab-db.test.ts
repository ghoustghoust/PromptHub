import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PromptVocabDB } from "@prompthub/db";
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
    } = {},
  ) {
    return db.addTerm({
      category: overrides.category ?? "style",
      en: overrides.en ?? "watercolor",
      zh: overrides.zh ?? null,
      applicableModels: overrides.applicableModels ?? [],
      ...(overrides.id === undefined ? {} : { id: overrides.id }),
      ...(overrides.series === undefined ? {} : { series: overrides.series }),
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