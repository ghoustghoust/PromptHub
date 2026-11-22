import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PromptVocabDB, migratePromptVocabSchema } from "@prompthub/db";
import { deriveEntityAliases, isNamedEntityTerm } from "@prompthub/shared/utils/prompt-entity-key";
import DatabaseAdapter from "../../../src/main/database/sqlite";

let rawDb: DatabaseAdapter.Database;
let db: PromptVocabDB;

/** Mirrors a pre-alias database: prompt_terms exists, term_aliases does not. */
function createLegacyDatabase(): void {
  rawDb = new DatabaseAdapter(":memory:");
  rawDb.pragma("foreign_keys = ON");
  rawDb.exec(`
    CREATE TABLE prompt_terms (
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
    );
  `);
  rawDb
    .prepare(
      `INSERT INTO prompt_terms (id, category, subcategory, en, zh, source, validation_status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run("legacy-ganyu", "character", "原神", "ganyu \\(genshin impact\\)", "甘雨（原神）", "prompt-generator-v3", "validated", 1763400000000);
  db = new PromptVocabDB(rawDb);
}

function tableNames(): string[] {
  return (rawDb.all("SELECT name FROM sqlite_master WHERE type = 'table'") as Array<{ name: string }>)
    .map((row) => row.name);
}

function aliasCount(): number {
  return (rawDb.get("SELECT COUNT(*) AS count FROM term_aliases") as { count: number }).count;
}

beforeEach(() => createLegacyDatabase());

afterEach(() => rawDb.close());

describe("term aliases on a legacy vocabulary database", () => {
  it("creates the alias table and its lookup index during migration", () => {
    expect(tableNames()).not.toContain("term_aliases");
    migratePromptVocabSchema(rawDb);
    expect(tableNames()).toContain("term_aliases");
    const indexes = (
      rawDb.all("PRAGMA index_list(term_aliases)") as Array<{ name: string }>
    ).map((row) => row.name);
    expect(indexes).toContain("idx_term_aliases_key");
    expect(db.getTerm("legacy-ganyu")?.zh).toBe("甘雨（原神）");
  });

  it("re-runs the migration and backfill without duplicating rows", () => {
    migratePromptVocabSchema(rawDb);
    const term = db.getTerm("legacy-ganyu");
    expect(term).not.toBeNull();
    if (!term) return;
    expect(isNamedEntityTerm(term)).toBe(true);
    const aliases = deriveEntityAliases({ en: term.en, zh: term.zh });
    expect(aliases.map((alias) => alias.key)).toEqual(
      expect.arrayContaining(["ganyu (genshin impact)", "ganyu", "甘雨"]),
    );
    const insert = (): number =>
      db.addTermAliases(
        aliases.map((alias) => ({ termId: term.id, alias: alias.alias, kind: alias.kind })),
      );
    const first = insert();
    expect(first).toBeGreaterThan(0);
    const afterFirst = aliasCount();
    migratePromptVocabSchema(rawDb);
    expect(insert()).toBe(0);
    expect(aliasCount()).toBe(afterFirst);
  });

  it("resolves every spelling to the same term and ignores deprecated rows", () => {
    migratePromptVocabSchema(rawDb);
    const term = db.getTerm("legacy-ganyu");
    if (!term) throw new Error("seed term missing");
    db.addTermAliases(
      deriveEntityAliases({ en: term.en, zh: term.zh }).map((alias) => ({
        termId: term.id,
        alias: alias.alias,
        kind: alias.kind,
      })),
    );

    const matches = db.resolveTermAliases([
      "ganyu (genshin impact)",
      "ganyu",
      "甘雨(原神)",
      "@ganyu",
    ]);
    expect(new Set(matches.map((match) => match.termId))).toEqual(new Set([term.id]));

    rawDb
      .prepare("UPDATE prompt_terms SET validation_status = 'deprecated' WHERE id = ?")
      .run(term.id);
    expect(db.resolveTermAliases(["ganyu"])).toEqual([]);
  });

  it("drops aliases with the term instead of leaving dangling lookups", () => {
    migratePromptVocabSchema(rawDb);
    const term = db.getTerm("legacy-ganyu");
    if (!term) throw new Error("seed term missing");
    db.addTermAliases([{ termId: term.id, alias: "ganyu", kind: "series_less" }]);
    expect(aliasCount()).toBeGreaterThan(0);
    rawDb.prepare("DELETE FROM prompt_terms WHERE id = ?").run(term.id);
    expect(aliasCount()).toBe(0);
  });
});
