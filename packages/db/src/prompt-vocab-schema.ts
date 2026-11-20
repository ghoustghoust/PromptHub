import type Database from "./adapter";

/**
 * Structured prompt vocabulary tables (prompt-vocab domain).
 *
 * Added to SCHEMA_TABLES so initDatabase creates them before migrations;
 * CREATE TABLE IF NOT EXISTS keeps this a safe no-op for existing databases.
 * JSON array/object columns (applicable_models, trigger_words, params, meta)
 * are stored as TEXT and parsed by PromptVocabDB.
 */
export const PROMPT_VOCAB_SCHEMA = `
CREATE TABLE IF NOT EXISTS prompt_terms (
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
  domain TEXT NOT NULL DEFAULT 'shared'
    CHECK(domain IN ('shared', 'anime', 'real', '3d')),
  validation_status TEXT NOT NULL DEFAULT 'unvalidated'
    CHECK(validation_status IN ('pending', 'unvalidated', 'validated', 'deprecated')),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS term_relations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  term_id TEXT NOT NULL REFERENCES prompt_terms(id) ON DELETE CASCADE,
  related_id TEXT NOT NULL REFERENCES prompt_terms(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL
    CHECK(relation_type IN ('synonym', 'combinable', 'conflict', 'precondition')),
  UNIQUE(term_id, related_id, relation_type)
);

CREATE TABLE IF NOT EXISTS model_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('base', 'lora')),
  trigger_words TEXT,
  weight_range TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS validation_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  term_id TEXT NOT NULL REFERENCES prompt_terms(id) ON DELETE CASCADE,
  model_id TEXT,
  params TEXT,
  outcome TEXT NOT NULL CHECK(outcome IN ('good', 'bad', 'neutral')),
  notes TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS source_assets (
  id TEXT PRIMARY KEY,
  kind TEXT,
  path TEXT,
  title TEXT,
  meta TEXT,
  created_at INTEGER NOT NULL
);
`;

function columnNames(rows: unknown[]): Set<string> {
  const names = new Set<string>();
  for (const row of rows) {
    if (typeof row === "object" && row !== null && "name" in row) {
      if (typeof row.name === "string") names.add(row.name);
    }
  }
  return names;
}

/** Idempotently upgrades databases created before series/template support. */
export function migratePromptVocabSchema(
  database: Database.Database,
): void {
  const columns = columnNames(database.all("PRAGMA table_info(prompt_terms)"));
  if (!columns.has("series")) {
    database.run("ALTER TABLE prompt_terms ADD COLUMN series TEXT");
  }
  if (!columns.has("template")) {
    database.run("ALTER TABLE prompt_terms ADD COLUMN template TEXT");
  }
  if (!columns.has("domain")) {
    database.run(
      "ALTER TABLE prompt_terms ADD COLUMN domain TEXT NOT NULL DEFAULT 'shared'",
    );
  }
}