import type Database from "./adapter";
import type {
  PromptReferenceItem,
  PromptReferenceStyleProfile,
} from "@prompthub/shared/types";

/**
 * Director color cards imported from prompt/new. Rows keep the source path and
 * hash, but the images stay in the read-only source tree.
 */
export const PROMPT_REFERENCE_SCHEMA = `
CREATE TABLE IF NOT EXISTS prompt_reference_items (
  id TEXT PRIMARY KEY,
  name_zh TEXT NOT NULL,
  name_en TEXT,
  category TEXT NOT NULL,
  nationality TEXT,
  era TEXT,
  summary TEXT NOT NULL,
  palette_json TEXT NOT NULL DEFAULT '[]',
  style_json TEXT NOT NULL DEFAULT '{}',
  thumbnail_path TEXT,
  source_path TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reference_items_category
  ON prompt_reference_items(category, name_zh);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reference_items_source
  ON prompt_reference_items(source_path);
`;

export function migratePromptReference(db: Database.Database): void {
  db.exec(PROMPT_REFERENCE_SCHEMA);
}

interface ReferenceRow {
  id: string;
  name_zh: string;
  name_en: string | null;
  category: string;
  nationality: string | null;
  era: string | null;
  summary: string;
  palette_json: string;
  style_json: string;
  thumbnail_path: string | null;
  source_path: string;
  source_hash: string;
  created_at: number;
  updated_at: number;
}

function stringArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

function styleProfile(value: string): PromptReferenceStyleProfile {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return { avoid: [] };
    const record = parsed as Record<string, unknown>;
    return {
      ...(typeof record.lighting === "string" ? { lighting: record.lighting } : {}),
      ...(typeof record.framing === "string" ? { framing: record.framing } : {}),
      ...(typeof record.grading === "string" ? { grading: record.grading } : {}),
      avoid: Array.isArray(record.avoid)
        ? record.avoid.filter((entry): entry is string => typeof entry === "string")
        : [],
    };
  } catch {
    return { avoid: [] };
  }
}

function toItem(row: ReferenceRow): PromptReferenceItem {
  return {
    id: row.id,
    nameZh: row.name_zh,
    ...(row.name_en ? { nameEn: row.name_en } : {}),
    category: row.category,
    ...(row.nationality ? { nationality: row.nationality } : {}),
    ...(row.era ? { era: row.era } : {}),
    summary: row.summary,
    palette: stringArray(row.palette_json),
    style: styleProfile(row.style_json),
    ...(row.thumbnail_path ? { thumbnailPath: row.thumbnail_path } : {}),
    sourcePath: row.source_path,
    sourceHash: row.source_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PromptReferenceDB {
  constructor(private readonly db: Database.Database) {}

  /** Imports metadata; an existing item at the same source path is replaced. */
  saveItems(items: PromptReferenceItem[]): void {
    this.db.transaction(() => {
      const remove = this.db.prepare("DELETE FROM prompt_reference_items WHERE source_path = ?");
      const insert = this.db.prepare(
        `INSERT INTO prompt_reference_items (
           id, name_zh, name_en, category, nationality, era, summary,
           palette_json, style_json, thumbnail_path, source_path, source_hash,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const item of items) {
        remove.run(item.sourcePath);
        insert.run(
          item.id,
          item.nameZh,
          item.nameEn ?? null,
          item.category,
          item.nationality ?? null,
          item.era ?? null,
          item.summary,
          JSON.stringify(item.palette),
          JSON.stringify(item.style),
          item.thumbnailPath ?? null,
          item.sourcePath,
          item.sourceHash,
          item.createdAt,
          item.updatedAt,
        );
      }
    })();
  }

  list(): PromptReferenceItem[] {
    const rows = this.db
      .prepare("SELECT * FROM prompt_reference_items ORDER BY category, name_zh")
      .all() as ReferenceRow[];
    return rows.map(toItem);
  }

  get(id: string): PromptReferenceItem | null {
    const row = this.db
      .prepare("SELECT * FROM prompt_reference_items WHERE id = ?")
      .get(id) as ReferenceRow | undefined;
    return row ? toItem(row) : null;
  }

  /** Looks up the record imported from one source directory. */
  findBySourcePath(sourcePath: string): PromptReferenceItem | null {
    const row = this.db
      .prepare("SELECT * FROM prompt_reference_items WHERE source_path = ?")
      .get(sourcePath) as ReferenceRow | undefined;
    return row ? toItem(row) : null;
  }

  remove(id: string): boolean {
    const result = this.db
      .prepare("DELETE FROM prompt_reference_items WHERE id = ?")
      .run(id);
    return Number(result.changes ?? 0) > 0;
  }
}