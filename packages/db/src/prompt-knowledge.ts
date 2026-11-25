import type Database from "./adapter";
import { MAX_KNOWLEDGE_PACK_MODULES } from "@prompthub/shared/utils/prompt-knowledge";
import type {
  PromptKnowledgeLink,
  PromptKnowledgeModule,
  PromptKnowledgeModuleLayer,
  PromptKnowledgeModulePriority,
  PromptKnowledgeModuleRole,
  PromptKnowledgePack,
  PromptKnowledgePackKind,
  PromptKnowledgePackStatus,
} from "@prompthub/shared/types";

/**
 * Imported knowledge packs are read-only text modules. Packs and modules are
 * stored separately so the writing layer can select a subset of modules; the
 * selection itself lives in the orchestrator workspace state, not here.
 */
export const PROMPT_KNOWLEDGE_SCHEMA = `
CREATE TABLE IF NOT EXISTS prompt_knowledge_packs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('skill', 'knowledge', 'preset', 'reference')),
  source_path TEXT,
  source_hash TEXT NOT NULL,
  version TEXT,
  variant TEXT,
  status TEXT NOT NULL CHECK(status IN ('ready', 'needs-review', 'disabled')),
  links_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_knowledge_packs_updated
  ON prompt_knowledge_packs(updated_at DESC, id);

CREATE TABLE IF NOT EXISTS prompt_knowledge_modules (
  id TEXT PRIMARY KEY,
  pack_id TEXT NOT NULL REFERENCES prompt_knowledge_packs(id) ON DELETE CASCADE,
  module_key TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT,
  scope TEXT,
  priority TEXT CHECK(priority IS NULL OR priority IN ('P0', 'P1', 'P2')),
  role TEXT NOT NULL DEFAULT 'knowledge'
    CHECK(role IN ('contract', 'knowledge', 'reference')),
  groups_json TEXT NOT NULL DEFAULT '[]',
  layer TEXT CHECK(layer IS NULL OR layer IN ('P', 'S', 'H')),
  triggers_json TEXT NOT NULL DEFAULT '[]',
  depends_on_json TEXT NOT NULL DEFAULT '[]',
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  tokens INTEGER NOT NULL CHECK(tokens >= 0),
  ord INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_knowledge_modules_pack
  ON prompt_knowledge_modules(pack_id, ord);
CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_modules_key
  ON prompt_knowledge_modules(pack_id, module_key);
CREATE INDEX IF NOT EXISTS idx_knowledge_modules_hash
  ON prompt_knowledge_modules(content_hash);
`;

export function migratePromptKnowledge(db: Database.Database): void {
  db.exec(PROMPT_KNOWLEDGE_SCHEMA);
  ensureColumn(db, "prompt_knowledge_packs", "links_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(
    db,
    "prompt_knowledge_modules",
    "role",
    "TEXT NOT NULL DEFAULT 'knowledge' CHECK(role IN ('contract', 'knowledge', 'reference'))",
  );
  ensureColumn(db, "prompt_knowledge_modules", "groups_json", "TEXT NOT NULL DEFAULT '[]'");
}

/** CREATE TABLE IF NOT EXISTS does not add columns to an existing table. */
function ensureColumn(
  db: Database.Database,
  table: string,
  column: string,
  definition: string,
): void {
  const columns = db.pragma(`table_info(${table})`) as Array<{ name?: string }>;
  if (!columns.some((entry) => entry.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

interface PackRow {
  id: string;
  name: string;
  kind: PromptKnowledgePackKind;
  source_path: string | null;
  source_hash: string;
  version: string | null;
  variant: string | null;
  status: PromptKnowledgePackStatus;
  links_json: string;
  created_at: number;
  updated_at: number;
}

interface ModuleRow {
  id: string;
  pack_id: string;
  module_key: string;
  title: string;
  category: string | null;
  scope: string | null;
  priority: PromptKnowledgeModulePriority | null;
  role: PromptKnowledgeModuleRole;
  groups_json: string;
  layer: PromptKnowledgeModuleLayer | null;
  triggers_json: string;
  depends_on_json: string;
  content: string;
  content_hash: string;
  tokens: number;
  ord: number;
}

function stringArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

function linkArray(value: string): PromptKnowledgeLink[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is PromptKnowledgeLink =>
      Boolean(entry) &&
      typeof entry === "object" &&
      typeof (entry as PromptKnowledgeLink).relation === "string" &&
      ((entry as PromptKnowledgeLink).targetType === "pack" ||
        (entry as PromptKnowledgeLink).targetType === "module") &&
      typeof (entry as PromptKnowledgeLink).targetKey === "string",
    );
  } catch {
    return [];
  }
}

function toPack(row: PackRow): PromptKnowledgePack {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    ...(row.source_path ? { sourcePath: row.source_path } : {}),
    sourceHash: row.source_hash,
    ...(row.version ? { version: row.version } : {}),
    ...(row.variant ? { variant: row.variant } : {}),
    status: row.status,
    ...(row.links_json && row.links_json !== "[]" ? { links: linkArray(row.links_json) } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toModule(row: ModuleRow): PromptKnowledgeModule {
  return {
    id: row.id,
    packId: row.pack_id,
    moduleKey: row.module_key,
    title: row.title,
    ...(row.category ? { category: row.category } : {}),
    ...(row.scope ? { scope: row.scope } : {}),
    ...(row.priority ? { priority: row.priority } : {}),
    role: row.role ?? "knowledge",
    contractGroups: stringArray(row.groups_json) as PromptKnowledgeModule["contractGroups"],
    ...(row.layer ? { layer: row.layer } : {}),
    triggers: stringArray(row.triggers_json),
    dependsOn: stringArray(row.depends_on_json),
    content: row.content,
    contentHash: row.content_hash,
    tokens: row.tokens,
    ord: row.ord,
  };
}

export class PromptKnowledgeDB {
  constructor(private readonly db: Database.Database) {}

  /** Writes a pack and all of its modules atomically. */
  createPack(pack: PromptKnowledgePack, modules: PromptKnowledgeModule[]): void {
    this.assertModules(pack, modules);
    this.db.transaction(() => this.insertPack(pack, modules))();
  }

  /**
   * Re-imports a pack rooted at the same source path: the previous rows are
   * removed in the same transaction, so a failed insert never loses them.
   */
  replacePack(pack: PromptKnowledgePack, modules: PromptKnowledgeModule[]): void {
    this.assertModules(pack, modules);
    this.db.transaction(() => {
      if (pack.sourcePath) {
        this.db
          .prepare(`DELETE FROM prompt_knowledge_packs WHERE source_path = ?`)
          .run(pack.sourcePath);
      }
      this.insertPack(pack, modules);
    })();
  }

  private assertModules(
    pack: PromptKnowledgePack,
    modules: PromptKnowledgeModule[],
  ): void {
    if (modules.length > MAX_KNOWLEDGE_PACK_MODULES) {
      throw new Error(
        `Knowledge pack supports at most ${MAX_KNOWLEDGE_PACK_MODULES} modules`,
      );
    }
    const seen = new Set<string>();
    for (const entry of modules) {
      if (entry.packId !== pack.id) {
        throw new Error(`Module ${entry.moduleKey} belongs to ${entry.packId}, not ${pack.id}`);
      }
      if (seen.has(entry.moduleKey)) {
        throw new Error(`Duplicate module key in pack: ${entry.moduleKey}`);
      }
      seen.add(entry.moduleKey);
    }
  }

  private insertPack(
    pack: PromptKnowledgePack,
    modules: PromptKnowledgeModule[],
  ): void {
    this.db
      .prepare(
        `INSERT INTO prompt_knowledge_packs (
           id, name, kind, source_path, source_hash, version, variant,
           status, links_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        pack.id,
        pack.name,
        pack.kind,
        pack.sourcePath ?? null,
        pack.sourceHash,
        pack.version ?? null,
        pack.variant ?? null,
        pack.status,
        JSON.stringify(pack.links ?? []),
        pack.createdAt,
        pack.updatedAt,
      );

    const insert = this.db.prepare(
      `INSERT INTO prompt_knowledge_modules (
         id, pack_id, module_key, title, category, scope, priority, role,
         groups_json, layer, triggers_json, depends_on_json, content, content_hash, tokens, ord
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const entry of modules) {
      insert.run(
        entry.id,
        entry.packId,
        entry.moduleKey,
        entry.title,
        entry.category ?? null,
        entry.scope ?? null,
        entry.priority ?? null,
        entry.role,
        JSON.stringify(entry.contractGroups ?? []),
        entry.layer ?? null,
        JSON.stringify(entry.triggers),
        JSON.stringify(entry.dependsOn),
        entry.content,
        entry.contentHash,
        entry.tokens,
        entry.ord,
      );
    }
  }

  listPacks(): PromptKnowledgePack[] {
    const rows = this.db
      .prepare(`SELECT * FROM prompt_knowledge_packs ORDER BY updated_at DESC, id`)
      .all() as PackRow[];
    return rows.map(toPack);
  }

  listModules(packId: string): PromptKnowledgeModule[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM prompt_knowledge_modules
          WHERE pack_id = ? ORDER BY ord, module_key`,
      )
      .all(packId) as ModuleRow[];
    return rows.map(toModule);
  }

  deletePack(packId: string): boolean {
    const result = this.db
      .prepare(`DELETE FROM prompt_knowledge_packs WHERE id = ?`)
      .run(packId);
    return Number(result.changes ?? 0) > 0;
  }
}
