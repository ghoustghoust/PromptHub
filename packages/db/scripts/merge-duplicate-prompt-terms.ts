/**
 * One-off maintenance merge of duplicate prompt_terms rows.
 *
 * Rows that share the same category and the same normalized en text (case,
 * underscores, escaped parentheses and spacing insensitive, matching the
 * resolveTerms normalization) are merged into one survivor: the best-validated
 * row, then the lowest id. Relations and validation records are remapped onto
 * the survivor before absorbed rows are deleted, so existing references never
 * dangle.
 *
 * Usage from the repository root (tsx resolves the workspace imports):
 *   apps\desktop\node_modules\.bin\tsx.cmd packages/db/scripts/merge-duplicate-prompt-terms.ts <db-path>
 *
 * The database is updated in place inside one transaction. Take a consistency
 * backup of the target file before running. Idempotent: a second run finds no
 * duplicate groups and merges nothing. This targets isolated/maintenance
 * databases; never run it against a formal profile without the change owner's
 * approval.
 */
import Database from "../src/adapter";
import { PromptVocabDB } from "../src/prompt-vocab";

const dbPath = process.argv[2];
const backupPath = process.argv[3];
if (typeof dbPath !== "string" || dbPath.trim().length === 0) {
  console.error("usage: merge-duplicate-prompt-terms.ts <db-path> [backup-path]");
  process.exit(1);
}

function count(sql: string): number {
  const row = adapter.prepare(sql).get() as { count: number };
  return row.count;
}

const adapter = new Database(dbPath);
try {
  if (typeof backupPath === "string" && backupPath.trim().length > 0) {
    // VACUUM INTO produces a self-consistent snapshot even while readers hold the file.
    adapter.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
    console.log(`consistency backup written to ${backupPath}`);
  }
  const before = {
    terms: count("SELECT COUNT(*) AS count FROM prompt_terms"),
    relations: count("SELECT COUNT(*) AS count FROM term_relations"),
    validations: count("SELECT COUNT(*) AS count FROM validation_records"),
  };
  const result = new PromptVocabDB(adapter).mergeDuplicatePromptTerms();
  const after = {
    terms: count("SELECT COUNT(*) AS count FROM prompt_terms"),
    relations: count("SELECT COUNT(*) AS count FROM term_relations"),
    validations: count("SELECT COUNT(*) AS count FROM validation_records"),
  };
  console.log(JSON.stringify({ before, after, ...result }, null, 2));
} finally {
  adapter.close();
}
