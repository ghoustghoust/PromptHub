import { beforeEach, describe, expect, it } from "vitest";
import { PromptKnowledgeDB, migratePromptKnowledge } from "@prompthub/db";
import type { PromptKnowledgeModule, PromptKnowledgePack } from "@prompthub/shared/types";
import DatabaseAdapter from "../../../src/main/database/sqlite";

let rawDb: DatabaseAdapter.Database;
let knowledge: PromptKnowledgeDB;

function pack(overrides: Partial<PromptKnowledgePack> = {}): PromptKnowledgePack {
  return {
    id: "pack-1",
    name: "Skill-Film",
    kind: "skill",
    sourcePath: "prompt/new/Skill-Film-v2.00.1",
    sourceHash: "pack-hash-1",
    version: "2.0.1",
    status: "ready",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function module(
  moduleKey: string,
  ord: number,
  overrides: Partial<PromptKnowledgeModule> = {},
): PromptKnowledgeModule {
  return {
    id: `module-${moduleKey}`,
    packId: "pack-1",
    moduleKey,
    title: moduleKey,
    category: "knowledge",
    priority: "P0",
    role: "knowledge",
    layer: "P",
    triggers: ["分镜"],
    dependsOn: [],
    content: `${moduleKey} content`,
    contentHash: `hash-${moduleKey}`,
    tokens: 3,
    ord,
    ...overrides,
  };
}

beforeEach(() => {
  rawDb = new DatabaseAdapter(":memory:");
  rawDb.pragma("foreign_keys = ON");
  migratePromptKnowledge(rawDb);
  knowledge = new PromptKnowledgeDB(rawDb);
});

describe("PromptKnowledgeDB", () => {
  it("round-trips a pack with its modules in draw order", () => {
    knowledge.createPack(pack(), [module("rules", 1), module("intro", 0, {
      priority: "P1",
      layer: "H",
      triggers: ["开场", "钩子"],
      dependsOn: ["rules"],
      scope: "通用影视",
    })]);

    const packs = knowledge.listPacks();
    expect(packs).toHaveLength(1);
    expect(packs[0]).toMatchObject({
      id: "pack-1",
      name: "Skill-Film",
      kind: "skill",
      version: "2.0.1",
      status: "ready",
    });

    const modules = knowledge.listModules("pack-1");
    expect(modules.map((entry) => entry.moduleKey)).toEqual(["intro", "rules"]);
    expect(modules[0]).toMatchObject({
      title: "intro",
      priority: "P1",
      layer: "H",
      triggers: ["开场", "钩子"],
      dependsOn: ["rules"],
      scope: "通用影视",
      ord: 0,
      tokens: 3,
    });
  });

  it("rejects a duplicate module key inside the same pack", () => {
    expect(() =>
      knowledge.createPack(pack(), [module("rules", 0), module("rules", 1, {
        id: "module-rules-2",
        contentHash: "hash-rules-2",
      })]),
    ).toThrow();
  });

  it("removes a pack together with its modules", () => {
    knowledge.createPack(pack(), [module("rules", 0)]);
    expect(knowledge.deletePack("pack-1")).toBe(true);
    expect(knowledge.listPacks()).toEqual([]);
    expect(knowledge.listModules("pack-1")).toEqual([]);
    expect(knowledge.deletePack("pack-1")).toBe(false);
  });

  it("replaces the pack imported from the same source path", () => {
    knowledge.createPack(pack(), [module("rules", 0)]);
    knowledge.replacePack(
      pack({ id: "pack-2", sourceHash: "pack-hash-2" }),
      [module("intro", 0, { id: "module-intro-2", packId: "pack-2" })],
    );

    const packs = knowledge.listPacks();
    expect(packs).toHaveLength(1);
    expect(packs[0]).toMatchObject({ id: "pack-2", sourceHash: "pack-hash-2" });
    expect(knowledge.listModules("pack-2").map((entry) => entry.moduleKey)).toEqual(["intro"]);
    expect(knowledge.listModules("pack-1")).toEqual([]);
  });

  it("round-trips module roles and pack links", () => {
    knowledge.createPack(
      pack({
        links: [
          { relation: "recommends", targetType: "pack", targetKey: "Skill-Film" },
          { relation: "depends_on", targetType: "module", targetKey: "camera" },
        ],
      }),
      [
        module("rules", 0, { role: "contract" }),
        module("examples", 1, { role: "knowledge", contentHash: "hash-examples" }),
        module("color-card", 2, {
          role: "reference",
          contentHash: "hash-color",
        }),
      ],
    );

    expect(knowledge.listPacks()[0].links).toEqual([
      { relation: "recommends", targetType: "pack", targetKey: "Skill-Film" },
      { relation: "depends_on", targetType: "module", targetKey: "camera" },
    ]);
    expect(knowledge.listModules("pack-1").map((entry) => entry.role)).toEqual([
      "contract",
      "knowledge",
      "reference",
    ]);
  });

  it("migrates legacy tables that lack role and links_json", () => {
    const legacy = new DatabaseAdapter(":memory:");
    legacy.exec(`
      CREATE TABLE prompt_knowledge_packs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        source_path TEXT,
        source_hash TEXT NOT NULL,
        version TEXT,
        variant TEXT,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE prompt_knowledge_modules (
        id TEXT PRIMARY KEY,
        pack_id TEXT NOT NULL,
        module_key TEXT NOT NULL,
        title TEXT NOT NULL,
        category TEXT,
        scope TEXT,
        priority TEXT,
        layer TEXT,
        triggers_json TEXT NOT NULL DEFAULT '[]',
        depends_on_json TEXT NOT NULL DEFAULT '[]',
        content TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        tokens INTEGER NOT NULL,
        ord INTEGER NOT NULL
      );
    `);
    migratePromptKnowledge(legacy);

    const packColumns = (legacy.pragma("table_info(prompt_knowledge_packs)") as Array<{ name: string }>)
      .map((entry) => entry.name);
    const moduleColumns = (legacy.pragma("table_info(prompt_knowledge_modules)") as Array<{ name: string }>)
      .map((entry) => entry.name);
    expect(packColumns).toContain("links_json");
    expect(moduleColumns).toContain("role");

    legacy
      .prepare(
        `INSERT INTO prompt_knowledge_packs
           (id, name, kind, source_hash, status, created_at, updated_at)
         VALUES ('legacy', 'Legacy', 'skill', 'hash', 'ready', 1, 1)`,
      )
      .run();
    legacy
      .prepare(
        `INSERT INTO prompt_knowledge_modules
           (id, pack_id, module_key, title, content, content_hash, tokens, ord)
         VALUES ('legacy-module', 'legacy', 'rules', 'Rules', 'body', 'hash-m', 1, 0)`,
      )
      .run();
    expect(new PromptKnowledgeDB(legacy).listModules("legacy")[0].role).toBe("knowledge");
    legacy.close();
  });
});
