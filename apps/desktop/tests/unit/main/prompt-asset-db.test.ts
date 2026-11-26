import { beforeEach, describe, expect, it } from "vitest";
import { PromptAssetDB, SCHEMA_TABLES } from "@prompthub/db";
import type { PromptSourceAsset } from "@prompthub/shared/types";
import DatabaseAdapter from "../../../src/main/database/sqlite";

let rawDb: DatabaseAdapter.Database;
let assets: PromptAssetDB;

function asset(overrides: Partial<PromptSourceAsset> = {}): PromptSourceAsset {
  return {
    id: "ghil:costume:SPR-0001",
    kind: "costume",
    path: "G:\\packs\\costume\\img\\SPR-0001.jpg",
    title: "象牙白荷叶边针织",
    meta: { category: "春装", keywords: ["象牙白", "针织"] },
    createdAt: 1,
    ...overrides,
  };
}

beforeEach(() => {
  rawDb = new DatabaseAdapter(":memory:");
  rawDb.pragma("foreign_keys = ON");
  rawDb.exec(SCHEMA_TABLES);
  assets = new PromptAssetDB(rawDb);
});

describe("PromptAssetDB", () => {
  it("stores an asset and reads it back with structured metadata", () => {
    const result = assets.saveAssets([asset()]);
    expect(result).toEqual({ inserted: 1, updated: 0 });

    const stored = assets.get("ghil:costume:SPR-0001");
    expect(stored).toMatchObject({
      id: "ghil:costume:SPR-0001",
      kind: "costume",
      path: "G:\\packs\\costume\\img\\SPR-0001.jpg",
      title: "象牙白荷叶边针织",
    });
    expect(stored?.meta).toEqual({ category: "春装", keywords: ["象牙白", "针织"] });
    expect(stored?.createdAt).toBe(1);
  });

  it("keeps the creation time of a known id and refreshes its content", () => {
    assets.saveAssets([asset()]);
    const result = assets.saveAssets([
      asset({
        title: "改写后的标题",
        path: "G:\\packs\\costume\\img\\SPR-0001-v2.jpg",
        meta: { category: "春装", keywords: ["象牙白"] },
        createdAt: 999,
      }),
    ]);
    expect(result).toEqual({ inserted: 0, updated: 1 });

    const stored = assets.get("ghil:costume:SPR-0001");
    expect(stored?.title).toBe("改写后的标题");
    expect(stored?.path).toBe("G:\\packs\\costume\\img\\SPR-0001-v2.jpg");
    expect(stored?.createdAt).toBe(1);
    expect(assets.list({ kind: "costume" }).total).toBe(1);
  });

  it("filters by library and by text and reports the total count", () => {
    assets.saveAssets([
      asset(),
      asset({ id: "ghil:hair:h-1", kind: "hair", title: "短发", meta: { length: "短发" } }),
      asset({ id: "ghil:pose:P001:front", kind: "pose", title: "S形站姿", meta: {} }),
    ]);

    expect(assets.countByKind()).toEqual([
      { kind: "costume", count: 1 },
      { kind: "hair", count: 1 },
      { kind: "pose", count: 1 },
    ]);

    const byKind = assets.list({ kind: "hair" });
    expect(byKind.total).toBe(1);
    expect(byKind.items[0].id).toBe("ghil:hair:h-1");

    const byText = assets.list({ query: "站姿" });
    expect(byText.total).toBe(1);
    expect(byText.items[0].id).toBe("ghil:pose:P001:front");

    const byMeta = assets.list({ query: "length" });
    expect(byMeta.total).toBe(1);
    expect(byMeta.items[0].id).toBe("ghil:hair:h-1");

    const paged = assets.list({ limit: 2, offset: 0 });
    expect(paged.items).toHaveLength(2);
    expect(paged.total).toBe(3);
    const next = assets.list({ limit: 2, offset: 2 });
    expect(next.items).toHaveLength(1);
  });

  it("leaves assets of another library untouched", () => {
    assets.saveAssets([asset({ id: "character:rpg:hero", kind: "character", title: "英雄" })]);
    assets.saveAssets([asset({ id: "ghil:portrait:f1", kind: "portrait", title: "正脸参考" })]);

    expect(assets.list({ kind: "character" }).items[0].title).toBe("英雄");
    expect(assets.list({ kind: "portrait" }).items[0].title).toBe("正脸参考");
    expect(assets.get("character:rpg:hero")?.kind).toBe("character");
  });
});
