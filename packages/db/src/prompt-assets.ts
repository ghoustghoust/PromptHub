import type Database from "./adapter";
import type {
  PromptAssetKindCount,
  PromptAssetQuery,
  PromptAssetQueryResult,
  PromptSourceAsset,
} from "@prompthub/shared/types";

/**
 * Read-only picture libraries. The rows only point at the original file in the
 * source directory; the pictures are never copied into the database.
 */
interface AssetRow {
  id: string;
  kind: string | null;
  path: string | null;
  title: string | null;
  meta: string | null;
  created_at: number;
}

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 1000;

function parseMeta(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

function toAsset(row: AssetRow): PromptSourceAsset {
  return {
    id: row.id,
    kind: row.kind,
    path: row.path,
    title: row.title,
    meta: parseMeta(row.meta),
    createdAt: row.created_at,
  };
}

export class PromptAssetDB {
  constructor(private readonly db: Database.Database) {}

  /**
   * Stores the assets by id. A known id keeps its creation time and only
   * refreshes the content, so re-importing a library never duplicates a row
   * and never touches an asset of another library.
   */
  saveAssets(assets: PromptSourceAsset[]): { inserted: number; updated: number } {
    let inserted = 0;
    let updated = 0;
    this.db.transaction(() => {
      const insert = this.db.prepare(
        `INSERT OR IGNORE INTO source_assets (id, kind, path, title, meta, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      const update = this.db.prepare(
        `UPDATE source_assets
         SET kind = ?, path = ?, title = ?, meta = ?
         WHERE id = ?`,
      );
      for (const asset of assets) {
        const meta = JSON.stringify(asset.meta ?? {});
        const result = insert.run(
          asset.id,
          asset.kind,
          asset.path,
          asset.title,
          meta,
          asset.createdAt,
        );
        if (Number(result.changes ?? 0) > 0) {
          inserted += 1;
          continue;
        }
        update.run(asset.kind, asset.path, asset.title, meta, asset.id);
        updated += 1;
      }
    })();
    return { inserted, updated };
  }

  get(id: string): PromptSourceAsset | null {
    const row = this.db
      .prepare("SELECT * FROM source_assets WHERE id = ?")
      .get(id) as AssetRow | undefined;
    return row ? toAsset(row) : null;
  }

  /** Page of assets with the total number of matching rows. */
  list(query: PromptAssetQuery = {}): PromptAssetQueryResult {
    const limit = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, Math.floor(query.limit ?? DEFAULT_PAGE_SIZE)),
    );
    const offset = Math.max(0, Math.floor(query.offset ?? 0));
    const conditions: string[] = [];
    const params: unknown[] = [];
    const kind = query.kind?.trim();
    if (kind) {
      conditions.push("kind = ?");
      params.push(kind);
    }
    const text = query.query?.trim();
    if (text) {
      conditions.push("(id LIKE ? OR title LIKE ? OR meta LIKE ?)");
      const like = `%${text}%`;
      params.push(like, like, like);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const countRow = this.db
      .prepare(`SELECT COUNT(*) AS count FROM source_assets ${where}`)
      .get(...params) as { count?: number } | undefined;
    const total = Number(countRow?.count ?? 0);
    const rows = this.db
      .prepare(
        `SELECT * FROM source_assets ${where} ORDER BY kind, id LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as AssetRow[];
    return { items: rows.map(toAsset), total };
  }

  /** Number of assets per library, for the filter list. */
  countByKind(): PromptAssetKindCount[] {
    const rows = this.db
      .prepare(
        "SELECT kind, COUNT(*) AS count FROM source_assets GROUP BY kind ORDER BY kind",
      )
      .all() as Array<{ kind: string | null; count?: number }>;
    return rows.map((row) => ({ kind: row.kind ?? "", count: Number(row.count ?? 0) }));
  }
}
