import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PromptReferenceDB, migratePromptReference } from "@prompthub/db";
import DatabaseAdapter from "../../../src/main/database/sqlite";
import {
  commitReferenceImport,
  previewReferenceLibrary,
} from "../../../src/main/services/prompt-reference-service";

let root: string;
let rawDb: DatabaseAdapter.Database;
let references: PromptReferenceDB;

function write(relativePath: string, content: string | Buffer): void {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "prompthub-reference-"));
  rawDb = new DatabaseAdapter(":memory:");
  migratePromptReference(rawDb);
  references = new PromptReferenceDB(rawDb);
});

afterEach(() => {
  rawDb.close();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("director color card import", () => {
  function seedDirector(): void {
    write(
      "01_黑色悬疑与冷调惊悚/001_Test_测试导演/assets/color_palettes/palette.json",
      JSON.stringify({
        director: {
          id: "001",
          name_en: "Test Director",
          name_zh: "测试导演",
          category: "01_黑色悬疑与冷调惊悚",
          nationality: "中国",
          active_years: "2000-至今",
        },
        palette: {
          primary: [
            { hex: "#112233" },
            { hex: "#445566" },
            { hex: "not-a-color" },
          ],
        },
      }),
    );
    write(
      "01_黑色悬疑与冷调惊悚/001_Test_测试导演/assets/references/reference_director_manifest.json",
      JSON.stringify({
        director: { zh: "测试导演", en: "Test Director" },
        style_profile: {
          definition: "低饱和冷调，硬光切分空间。",
          lighting: "侧逆硬光",
          framing: "对称固定机位",
          grading: "去饱和冷灰",
          avoid: ["暖色滤镜"],
        },
      }),
    );
    write(
      "01_黑色悬疑与冷调惊悚/001_Test_测试导演/assets/color_palettes/palette_main.png",
      Buffer.from("png"),
    );
    write(
      "01_黑色悬疑与冷调惊悚/001_Test_测试导演/色卡主文档.md",
      "# 测试导演\n\n> 备用简介\n",
    );
    // A folder without palette.json must be reported as skipped.
    write("01_黑色悬疑与冷调惊悚/002_NoPalette_缺色卡/色卡主文档.md", "# 缺色卡\n");
  }

  it("reads palette metadata, style profile and a thumbnail", () => {
    seedDirector();
    const preview = previewReferenceLibrary(root);

    expect(preview.items).toHaveLength(1);
    expect(preview.skipped).toHaveLength(1);
    expect(preview.skipped[0].path).toContain("缺色卡");
    const [item] = preview.items;
    expect(item).toMatchObject({
      nameZh: "测试导演",
      nameEn: "Test Director",
      category: "黑色悬疑与冷调惊悚",
      nationality: "中国",
      era: "2000-至今",
      summary: "低饱和冷调，硬光切分空间。",
      palette: ["#112233", "#445566"],
      style: {
        lighting: "侧逆硬光",
        framing: "对称固定机位",
        grading: "去饱和冷灰",
        avoid: ["暖色滤镜"],
      },
    });
    expect(item.thumbnailPath).toContain("palette_main.png");
    expect(preview.categories).toEqual([{ name: "黑色悬疑与冷调惊悚", count: 1 }]);
  });

  it("falls back to the main document when the manifest is missing", () => {
    write(
      "01_黑色悬疑与冷调惊悚/003_NoManifest_无清单/assets/color_palettes/palette.json",
      JSON.stringify({
        director: { name_zh: "无清单导演", category: "01_黑色悬疑与冷调惊悚" },
        palette: { primary: [{ hex: "#010203" }] },
      }),
    );
    write(
      "01_黑色悬疑与冷调惊悚/003_NoManifest_无清单/色卡主文档.md",
      [
        "# 无清单导演",
        "> **分类**：01 黑色悬疑",
        "",
        "## 一、核心风格一句话",
        "",
        "> 冷白与深黑对切，空间像手术室。",
        "",
        "## 二、色板构成",
        "",
        "### 光影特征",
        "- **主光方向**：顶光",
        "- **对比度**：高",
        "",
        "### 构图与运镜",
        "固定机位 · 对称构图",
        "",
        "### 色彩与光影",
        "冷白 · 深黑 · 低饱和",
      ].join("\n"),
    );

    const preview = previewReferenceLibrary(root);
    const item = preview.items.find((entry) => entry.nameZh === "无清单导演");
    expect(item).toMatchObject({
      summary: "冷白与深黑对切，空间像手术室。",
      palette: ["#010203"],
      style: {
        lighting: "冷白 · 深黑 · 低饱和",
        framing: "固定机位 · 对称构图",
      },
    });
    expect(item?.style.grading).toContain("顶光");
  });

  it("commits metadata and replaces the same source on re-import", () => {
    seedDirector();
    const preview = previewReferenceLibrary(root);
    const first = commitReferenceImport(references, preview);
    expect(first.itemIds).toHaveLength(1);
    expect(references.list()[0].palette).toEqual(["#112233", "#445566"]);

    const second = commitReferenceImport(references, preview);
    expect(second.itemIds).toHaveLength(1);
    expect(references.list()).toHaveLength(1);
    expect(references.list()[0].id).toBe(second.itemIds[0]);
  });
});

describe("director identity in the color card library", () => {
  function writeCard(
    directory: string,
    director: Record<string, unknown>,
    summary: string,
  ): void {
    write(
      `${directory}/assets/color_palettes/palette.json`,
      JSON.stringify({
        director: {
          name_zh: "测试导演",
          category: "01_黑色悬疑与冷调惊悚",
          ...director,
        },
        palette: { primary: [{ hex: "#112233" }] },
      }),
    );
    write(
      `${directory}/assets/references/reference_director_manifest.json`,
      JSON.stringify({
        director: { zh: "测试导演" },
        style_profile: { definition: summary },
      }),
    );
  }

  it("reads the director id declared by the source card", () => {
    writeCard("01_黑色悬疑与冷调惊悚/001_Test_测试导演", { id: "001" }, "冷调。");
    const preview = previewReferenceLibrary(root);
    expect(preview.items).toHaveLength(1);
    expect(preview.items[0].directorId).toBe("001");
    expect(preview.conflicts).toEqual([]);
  });

  it("reports a card without a director id instead of guessing one", () => {
    writeCard("01_黑色悬疑与冷调惊悚/002_NoId_无编号", {}, "冷调。");
    const preview = previewReferenceLibrary(root);
    expect(preview.items).toHaveLength(1);
    expect(preview.items[0].directorId).toBeUndefined();
    expect(preview.conflicts).toEqual([
      { path: expect.stringContaining("无编号"), reason: "missing-director-id" },
    ]);
  });

  it("skips a second card that claims the same director id", () => {
    writeCard("01_黑色悬疑与冷调惊悚/001_First_第一位", { id: "001" }, "冷调。");
    writeCard("01_黑色悬疑与冷调惊悚/002_Second_第二位", { id: "001" }, "暖调。");
    const preview = previewReferenceLibrary(root);
    expect(preview.items).toHaveLength(1);
    expect(preview.items[0].sourcePath).toContain("第一位");
    const duplicate = preview.skipped.find((entry) => entry.path.includes("第二位"));
    expect(duplicate?.reason).toContain("duplicate director id 001");
  });

  it("keeps the record id and creation time across a same-source re-import", () => {
    writeCard("01_黑色悬疑与冷调惊悚/001_Test_测试导演", { id: "001" }, "冷调。");
    const first = commitReferenceImport(references, previewReferenceLibrary(root));
    const stored = references.list()[0];
    expect(first.itemIds).toEqual([stored.id]);

    writeCard("01_黑色悬疑与冷调惊悚/001_Test_测试导演", { id: "001" }, "暖调，改写后的简介。");
    const second = commitReferenceImport(references, previewReferenceLibrary(root));
    const updated = references.list()[0];
    expect(second.itemIds).toEqual([stored.id]);
    expect(updated.id).toBe(stored.id);
    expect(updated.createdAt).toBe(stored.createdAt);
    expect(updated.summary).toBe("暖调，改写后的简介。");
    expect(updated.sourceHash).not.toBe(stored.sourceHash);
    expect(updated.updatedAt).toBeGreaterThanOrEqual(stored.updatedAt);
  });

  it("leaves other directors untouched and keeps saved selections resolvable", () => {
    writeCard("01_黑色悬疑与冷调惊悚/001_First_第一位", { id: "001" }, "冷调。");
    writeCard("01_黑色悬疑与冷调惊悚/002_Second_第二位", { id: "002" }, "暖调。");
    commitReferenceImport(references, previewReferenceLibrary(root));
    const [first, second] = references.list();
    const savedSelection = first.id;

    writeCard("01_黑色悬疑与冷调惊悚/001_First_第一位", { id: "001" }, "冷调，改写。");
    commitReferenceImport(references, previewReferenceLibrary(root));

    const rows = references.list();
    expect(rows).toHaveLength(2);
    const updatedFirst = rows.find((row) => row.id === savedSelection);
    expect(updatedFirst).toBeDefined();
    expect(updatedFirst?.summary).toBe("冷调，改写。");
    expect(rows.find((row) => row.id === second.id)?.createdAt).toBe(second.createdAt);
    expect(rows.find((row) => row.id === second.id)?.summary).toBe(second.summary);
    // A selection stored in the workspace still resolves to the same record.
    expect(references.get(savedSelection)?.id).toBe(savedSelection);
  });
});