import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PromptAssetDB, SCHEMA_TABLES } from "@prompthub/db";
import DatabaseAdapter from "../../../src/main/database/sqlite";
import {
  commitAssetImport,
  previewAssetLibrary,
} from "../../../src/main/services/prompt-asset-service";

let root: string;
let rawDb: DatabaseAdapter.Database;
let assets: PromptAssetDB;

function write(relativePath: string, content: string | Buffer): void {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function writeJson(relativePath: string, value: unknown): void {
  write(relativePath, JSON.stringify(value));
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "prompthub-assets-"));
  rawDb = new DatabaseAdapter(":memory:");
  rawDb.exec(SCHEMA_TABLES);
  assets = new PromptAssetDB(rawDb);
});

afterEach(() => {
  rawDb.close();
  fs.rmSync(root, { recursive: true, force: true });
});

function seedLibrary(): void {
  write("costume/img/SPR-0001.jpg", Buffer.from("jpg"));
  write("costume/thumbs/SPR-0001.webp", Buffer.from("webp"));
  writeJson("costume/data/costume-zh.json", [
    {
      id: "SPR-0001",
      分类: "春装",
      关键词: ["象牙白", "针织"],
      英文关键词: "ivory knit",
      缩略图: "thumbs/SPR-0001.webp",
      原图: "img/SPR-0001.jpg",
    },
    {
      id: "SPR-0002",
      分类: "夏装",
      关键词: ["白衬衫"],
      英文关键词: "white shirt",
      缩略图: "thumbs/SPR-0002.webp",
      原图: "img/SPR-0002.jpg",
    },
  ]);

  write("hair/img/h-1.jpg", Buffer.from("jpg"));
  write("hair/img/h-2.jpg", Buffer.from("jpg"));
  writeJson("hair/data/hairstyle-zh.json", [
    {
      id: "h-1",
      section: "hairstyle",
      hair: "ショート",
      section_zh: "假人发型",
      hair_zh: "短发",
      title: "短发发型",
      full: "img/h-1.jpg",
      thumb: "thumbs/h-1.webp",
      source_id: "p-1",
      source_section: "face",
    },
    {
      id: "h-2",
      section: "hairstyle",
      title: "长发发型",
      full: "img/h-2.jpg",
      source_id: "p-missing",
    },
  ]);

  write("portrait/img/p-1.jpg", Buffer.from("jpg"));
  writeJson("portrait/data/portrait-zh.json", [
    {
      id: "p-1",
      section: "face",
      section_zh: "正脸参考",
      hair_zh: "短发",
      title: "短发·正脸参考",
      full: "img/p-1.jpg",
      thumb: "thumbs/p-1.webp",
    },
  ]);

  write("pose/img/P001-front.jpg", Buffer.from("jpg"));
  writeJson("pose/data/pose-zh.json", [
    {
      id: "full_P001_front",
      体系: "全身单人",
      姿势编号: "P001",
      分类: "站姿",
      姿势名称: "S形站姿",
      角度: "正面",
      缩略图: "thumbs/P001-front.jpg",
      原图: "img/P001-front.jpg",
    },
  ]);

  // The folder without an index must never be read.
  write("自定义/notes.txt", "no index here");
  write("自定义/broken.json", "{not json");
}

describe("014 picture library import", () => {
  it("reads the four libraries and reports missing pictures and relations", () => {
    seedLibrary();
    const preview = previewAssetLibrary(root);

    expect(preview.counts).toEqual({ costume: 1, hair: 2, portrait: 1, pose: 1 });
    expect(preview.items.map((item) => item.id)).toEqual([
      "ghil:costume:SPR-0001",
      "ghil:hair:h-1",
      "ghil:hair:h-2",
      "ghil:portrait:p-1",
      "ghil:pose:全身单人:P001:正面",
    ]);

    const missingPicture = preview.skipped.find(
      (entry) => entry.id === "ghil:costume:SPR-0002",
    );
    expect(missingPicture?.reason).toContain("picture file is missing");
    expect(preview.items.some((item) => item.id === "ghil:costume:SPR-0002")).toBe(false);

    const missingRelation = preview.conflicts.find(
      (entry) => entry.reason === "missing-source-relation",
    );
    expect(missingRelation?.id).toBe("ghil:hair:h-2");
    expect(missingRelation?.detail).toContain("p-missing");
  });

  it("keeps the original labels, the thumbnail and the relation in the metadata", () => {
    seedLibrary();
    const preview = previewAssetLibrary(root);
    const costume = preview.items.find((item) => item.kind === "costume");
    expect(costume?.title).toBe("象牙白 针织");
    expect(costume?.meta).toMatchObject({
      library: "ghil",
      sourceId: "SPR-0001",
      category: "春装",
      keywords: ["象牙白", "针织"],
      englishKeywords: "ivory knit",
      thumbnail: path.join(root, "costume", "thumbs", "SPR-0001.webp"),
    });
    expect(costume?.path).toBe(path.join(root, "costume", "img", "SPR-0001.jpg"));

    const hair = preview.items.find((item) => item.id === "ghil:hair:h-1");
    expect(hair?.title).toBe("短发发型");
    expect(hair?.meta).toMatchObject({
      section: "hairstyle",
      sectionZh: "假人发型",
      hairZh: "短发",
      sourceId: "h-1",
    });

    const pose = preview.items.find((item) => item.kind === "pose");
    expect(pose?.title).toBe("S形站姿");
    expect(pose?.meta).toMatchObject({
      group: "全身单人",
      poseNumber: "P001",
      angle: "正面",
      category: "站姿",
    });
  });

  it("commits the assets into source_assets and repeats without duplicating them", () => {
    seedLibrary();
    const preview = previewAssetLibrary(root);

    const first = commitAssetImport(assets, preview);
    expect(first.inserted).toBe(5);
    expect(first.updated).toBe(0);
    expect(first.assetIds).toHaveLength(5);

    const stored = assets.get("ghil:costume:SPR-0001");
    expect(stored?.kind).toBe("costume");
    expect(stored?.path).toBe(path.join(root, "costume", "img", "SPR-0001.jpg"));
    expect(stored?.title).toBe("象牙白 针织");
    expect(stored?.meta).toMatchObject({ englishKeywords: "ivory knit" });

    const second = commitAssetImport(assets, preview);
    expect(second.inserted).toBe(0);
    expect(second.updated).toBe(5);
    expect(assets.list({ kind: "costume" }).total).toBe(1);
    expect(assets.countByKind()).toEqual([
      { kind: "costume", count: 1 },
      { kind: "hair", count: 2 },
      { kind: "portrait", count: 1 },
      { kind: "pose", count: 1 },
    ]);
  });

  it("reports a library whose index file is missing", () => {
    seedLibrary();
    fs.rmSync(path.join(root, "hair", "data", "hairstyle-zh.json"));
    const preview = previewAssetLibrary(root);
    const missing = preview.skipped.find((entry) => entry.id.includes("hair"));
    expect(missing?.reason).toBe("library index file is missing");
    expect(preview.counts.hair).toBeUndefined();
  });

  it("rejects a root that is not a directory", () => {
    expect(() => previewAssetLibrary(path.join(root, "missing"))).toThrow(
      "not a directory",
    );
  });
});
