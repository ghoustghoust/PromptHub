import { beforeEach, describe, expect, it } from "vitest";
import { PromptReferenceDB, migratePromptReference } from "@prompthub/db";
import type { PromptReferenceItem } from "@prompthub/shared/types";
import DatabaseAdapter from "../../../src/main/database/sqlite";

let rawDb: DatabaseAdapter.Database;
let references: PromptReferenceDB;

function item(overrides: Partial<PromptReferenceItem> = {}): PromptReferenceItem {
  return {
    id: "ref-1",
    nameZh: "大卫·芬奇",
    nameEn: "David Fincher",
    category: "黑色悬疑与冷调惊悚",
    nationality: "美国",
    era: "1985-至今",
    summary: "暗绿黄色调下的病态冷调美学。",
    palette: ["#1A2E2A", "#3D4F4F"],
    style: { lighting: "侧逆光", avoid: ["统一滤镜"] },
    thumbnailPath: "G:\\packs\\fincher\\palette_main.png",
    sourcePath: "G:\\packs\\fincher",
    sourceHash: "hash-1",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

beforeEach(() => {
  rawDb = new DatabaseAdapter(":memory:");
  migratePromptReference(rawDb);
  references = new PromptReferenceDB(rawDb);
});

describe("PromptReferenceDB", () => {
  it("round-trips reference metadata and palette order", () => {
    references.saveItems([item()]);
    const [stored] = references.list();
    expect(stored).toMatchObject({
      nameZh: "大卫·芬奇",
      nameEn: "David Fincher",
      category: "黑色悬疑与冷调惊悚",
      nationality: "美国",
      era: "1985-至今",
      summary: "暗绿黄色调下的病态冷调美学。",
      palette: ["#1A2E2A", "#3D4F4F"],
      style: { lighting: "侧逆光", avoid: ["统一滤镜"] },
      thumbnailPath: "G:\\packs\\fincher\\palette_main.png",
    });
    expect(references.get(stored.id)?.sourceHash).toBe("hash-1");
  });

  it("replaces an item imported from the same source path", () => {
    references.saveItems([item()]);
    references.saveItems([item({ id: "ref-2", sourceHash: "hash-2", summary: "updated" })]);
    const rows = references.list();
    expect(rows).toHaveLength(1);
    expect(rows[0].sourceHash).toBe("hash-2");
    expect(rows[0].summary).toBe("updated");
  });

  it("removes an item by id", () => {
    references.saveItems([item()]);
    expect(references.remove("ref-1")).toBe(true);
    expect(references.list()).toEqual([]);
    expect(references.remove("ref-1")).toBe(false);
  });
});