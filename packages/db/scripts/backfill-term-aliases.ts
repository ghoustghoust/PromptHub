/**
 * Backfills deterministic identity aliases (`term_aliases`) from existing
 * prompt terms.
 *
 * Scope is deliberately narrow: characters that pass `isNamedEntityTerm` plus
 * non-danbooru artists. The 59k danbooru artist rows contain many symbol-only
 * names (`!!`, `#b7282e`, `$hu`); importing those as lookup keys would create
 * more false mentions than useful hits. Curated aliases can be added later.
 *
 * Usage from the repository root:
 *   apps\desktop\node_modules\.bin\tsx.cmd packages/db/scripts/backfill-term-aliases.ts <db-path>
 *
 * Writes only to the database passed on the command line. A consistency
 * snapshot is written next to it first. Idempotent: a second run inserts 0.
 */
import path from "node:path";
import Database from "../src/adapter";
import { PromptVocabDB } from "../src/prompt-vocab";
import { migratePromptVocabSchema } from "../src/prompt-vocab-schema";
import {
  deriveEntityAliases,
  isNamedEntityTerm,
} from "@prompthub/shared/utils/prompt-entity-key";

interface TermRow {
  id: string;
  category: string;
  subcategory: string | null;
  en: string;
  zh: string | null;
}

const dbPath = process.argv[2];
if (typeof dbPath !== "string" || dbPath.trim().length === 0) {
  console.error("usage: backfill-term-aliases.ts <db-path>");
  process.exit(1);
}

function inScope(row: TermRow): boolean {
  if (row.category === "artist") return row.subcategory !== "danbooru";
  return row.category === "character";
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

const adapter = new Database(dbPath);
try {
  const backupPath = path.resolve(`${dbPath}.aliases-${stamp()}.bak`);
  // VACUUM INTO produces a self-consistent snapshot even while readers hold the file.
  adapter.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
  console.log(`consistency backup written to ${backupPath}`);

  migratePromptVocabSchema(adapter);
  const vocabulary = new PromptVocabDB(adapter);
  const rows = adapter
    .prepare(
      `SELECT id, category, subcategory, en, zh
         FROM prompt_terms
        WHERE validation_status <> 'deprecated'
          AND category IN ('character', 'artist')
        ORDER BY id ASC`,
    )
    .all() as TermRow[];

  let eligible = 0;
  let inserted = 0;
  for (let offset = 0; offset < rows.length; offset += 500) {
    const batch = rows.slice(offset, offset + 500);
    const entries: Array<{ termId: string; alias: string; kind: "canonical" | "series_less" | "zh" }> = [];
    for (const row of batch) {
      if (!inScope(row) || !isNamedEntityTerm(row)) continue;
      eligible += 1;
      for (const alias of deriveEntityAliases({ en: row.en, zh: row.zh })) {
        entries.push({ termId: row.id, alias: alias.alias, kind: alias.kind });
      }
    }
    inserted += vocabulary.addTermAliases(entries);
  }

  const total = adapter.prepare("SELECT COUNT(*) AS count FROM term_aliases").get() as {
    count: number;
  };
  const ambiguous = adapter
    .prepare(
      `SELECT COUNT(*) AS count FROM (
         SELECT alias_key FROM term_aliases
          GROUP BY alias_key HAVING COUNT(DISTINCT term_id) > 1
       )`,
    )
    .get() as { count: number };
  console.log(
    JSON.stringify(
      {
        scanned: rows.length,
        eligible,
        inserted,
        aliases: total.count,
        ambiguousKeys: ambiguous.count,
      },
      null,
      2,
    ),
  );
} finally {
  adapter.close();
}
