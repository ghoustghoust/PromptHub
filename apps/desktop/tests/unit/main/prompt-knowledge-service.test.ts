import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PromptKnowledgeDB, migratePromptKnowledge } from "@prompthub/db";
import DatabaseAdapter from "../../../src/main/database/sqlite";
import {
  commitKnowledgeImport,
  previewKnowledgePack,
} from "../../../src/main/services/prompt-knowledge-service";

let root: string;
let rawDb: DatabaseAdapter.Database;
let knowledge: PromptKnowledgeDB;

function write(relativePath: string, content: string): void {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "prompthub-knowledge-"));
  rawDb = new DatabaseAdapter(":memory:");
  rawDb.pragma("foreign_keys = ON");
  migratePromptKnowledge(rawDb);
  knowledge = new PromptKnowledgeDB(rawDb);
});

afterEach(() => {
  rawDb.close();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("knowledge pack scan and preview", () => {
  it("reads frontmatter and splits SKILL.md by level-2 headings", () => {
    write(
      "SKILL.md",
      [
        "---",
        "name: Skill-Film",
        "version: 2.0.1",
        "---",
        "# Skill-Film",
        "## Definition",
        "Define the film grammar.",
        "",
        "## 时间码",
        "Shot 01 starts at 00:00.",
        "",
        "## 预算",
        "Budget is fixed.",
      ].join("\n"),
    );

    const preview = previewKnowledgePack(root);
    expect(preview.packs).toHaveLength(1);
    const pack = preview.packs[0];
    expect(pack.name).toBe("Skill-Film");
    expect(pack.version).toBe("2.0.1");
    expect(pack.kind).toBe("skill");
    expect(pack.modules.map((entry) => entry.title)).toEqual(["Definition", "时间码", "预算"]);
    expect(pack.modules.map((entry) => entry.layer)).toEqual(["P", "S", "H"]);
    expect(pack.modules.map((entry) => entry.ord)).toEqual([0, 1, 2]);
    expect(pack.modules[0].tokens).toBeGreaterThan(0);
    expect(new Set(pack.modules.map((entry) => entry.moduleKey)).size).toBe(3);
    expect(preview.moduleCount).toBe(3);
  });

  it("prefers index.md sections over SKILL.md sections", () => {
    write("SKILL.md", "---\nname: Pack\n---\n## FromSkill\nskill body");
    write("index.md", "## Alpha\nfirst body\n\n## Beta\nsecond body");

    const preview = previewKnowledgePack(root);
    expect(preview.packs[0].modules.map((entry) => entry.title)).toEqual(["Alpha", "Beta"]);
  });

  it("imports markdown under 知识, skips backups/agents/tools and non-markdown", () => {
    write("SKILL.md", "---\nname: Pack\n---\n");
    write("知识/分镜/开场.md", "## 时间码\nShot 01 starts the scene.");
    write("知识/分镜/_备份/old.md", "## Rules\nold copy");
    write("agents/helper.md", "## Rules\nagent helper");
    write("tools/run.md", "## Rules\nscript wrapper");
    write("工具.py", "print('never executed')");

    const preview = previewKnowledgePack(root);
    expect(preview.packs[0].modules.map((entry) => entry.title)).toEqual(["开场"]);
    expect(preview.packs[0].modules[0]).toMatchObject({
      category: "分镜",
      layer: "S",
    });
    const reasons = preview.skipped.map((entry) => entry.reason).join(" ");
    expect(reasons).toMatch(/backup/i);
    expect(reasons).toMatch(/agents/);
    expect(reasons).toMatch(/tools/);
    expect(reasons).toMatch(/markdown/i);
  });

  it("drops duplicate content and skips a module above the token limit", () => {
    write("SKILL.md", "---\nname: Pack\n---\n");
    write("知识/a.md", "## Rules\nsame body");
    write("知识/b.md", "## Rules\nsame body");
    write("知识/huge.md", `## Rules\n${"字 ".repeat(6001)}`);

    const preview = previewKnowledgePack(root);
    expect(preview.packs[0].modules).toHaveLength(1);
    expect(preview.conflicts.map((entry) => entry.reason)).toContain("duplicate-content");
    expect(preview.skipped.some((entry) => /6000|token/i.test(entry.reason))).toBe(true);
    expect(preview.totalTokens).toBeGreaterThan(0);
  });

  it("reads module frontmatter and skips inject: false", () => {
    write("SKILL.md", "---\nname: Pack\n---\n");
    write(
      "知识/narrative/action.md",
      [
        "---",
        "module: action-choreography",
        "name: 动作设计",
        "category: narrative",
        "scope: 短剧与漫剧",
        "priority: P1",
        "triggers: 动作, 打斗",
        "depends_on: camera, continuity",
        "inject: true",
        "---",
        "SECTION ACTION: ACTION",
        "> Definition: break a fight into parameters.",
      ].join("\n"),
    );
    write(
      "知识/narrative/hidden.md",
      "---\nmodule: hidden\nname: Hidden\ninject: false\n---\nnot imported",
    );

    const preview = previewKnowledgePack(root);
    expect(preview.packs[0].modules).toHaveLength(1);
    expect(preview.packs[0].modules[0]).toMatchObject({
      moduleKey: "action-choreography",
      title: "动作设计",
      category: "narrative",
      scope: "短剧与漫剧",
      priority: "P1",
      triggers: ["动作", "打斗"],
      dependsOn: ["camera", "continuity"],
      layer: "P",
    });
    expect(preview.skipped.some((entry) => /inject/i.test(entry.reason))).toBe(true);
  });

  it("rejects a pack above 200 modules", () => {
    write("SKILL.md", "---\nname: Pack\n---\n");
    for (let index = 0; index < 201; index += 1) {
      write(`知识/m-${index}.md`, `## Rules\nbody ${index}`);
    }
    expect(() => previewKnowledgePack(root)).toThrow(/200/);
  });

  it("marks contract-shaped sections as always-on and keeps tools as knowledge", () => {
    write(
      "SKILL.md",
      [
        "---",
        "name: Storyboard s9",
        "---",
        "## 版本与适用范围",
        "v9",
        "## 读取顺序与执行入口",
        "read in order",
        "## 目标",
        "goal",
        "## 铁律与红线",
        "never break",
        "## 核心工具",
        "tool table",
      ].join("\n"),
    );

    const preview = previewKnowledgePack(root);
    expect(preview.packs[0].modules.map((entry) => entry.role)).toEqual([
      "contract",
      "contract",
      "contract",
      "contract",
      "knowledge",
    ]);
  });

  it("splits standalone knowledge documents by heading into knowledge modules", () => {
    write(
      "剧本.md",
      "# 剧本方法\n## 定义\n剧本结构的定义。\n\n## 时间码\n按时间码拆场。",
    );
    write("小说.md", "小说改编要点，无二级标题。");

    const preview = previewKnowledgePack(root);
    expect(preview.packs[0].kind).toBe("knowledge");
    expect(preview.packs[0].name).toBe(path.basename(root));
    expect(preview.packs[0].modules.map((entry) => entry.title)).toEqual([
      "剧本 · 定义",
      "剧本 · 时间码",
      "小说",
    ]);
    expect(preview.packs[0].modules.map((entry) => entry.layer)).toEqual(["P", "S", "H"]);
    expect(preview.packs[0].modules[0].category).toBe("剧本");
  });

  it("falls back to the directory name and a single overview module", () => {
    write("SKILL.md", "Plain body without headings.");

    const preview = previewKnowledgePack(root);
    expect(preview.packs[0].name).toBe(path.basename(root));
    expect(preview.packs[0].modules).toHaveLength(1);
    expect(preview.packs[0].modules[0]).toMatchObject({
      title: "overview",
      layer: "H",
    });
  });

  describe("commitKnowledgeImport", () => {
    function seed(): void {
      write("SKILL.md", "---\nname: Pack\nversion: 1.2.3\n---\n");
      write(
        "知识/a.md",
        "---\nmodule: alpha\nname: Alpha\npriority: P0\n---\n## Rules\nalpha body",
      );
      write("知识/b.md", "---\nmodule: beta\nname: Beta\n---\n## 时间码\nbeta body");
    }

    it("writes the preview into packs and modules", () => {
      seed();
      const preview = previewKnowledgePack(root);
      const result = commitKnowledgeImport(knowledge, preview);

      expect(result.packIds).toHaveLength(1);
      expect(result.moduleCount).toBe(2);
      const packs = knowledge.listPacks();
      expect(packs[0]).toMatchObject({
        id: result.packIds[0],
        name: "Pack",
        version: "1.2.3",
        status: "ready",
      });
      expect(packs[0].sourceHash).toMatch(/^[0-9a-f]{64}$/);
      const modules = knowledge.listModules(result.packIds[0]);
      expect(modules.map((entry) => entry.moduleKey)).toEqual(["alpha", "beta"]);
      expect(modules[0]).toMatchObject({
        title: "Alpha",
        priority: "P0",
        content: "## Rules\nalpha body",
        ord: 0,
      });
      expect(modules[1].content).toBe("## 时间码\nbeta body");
    });

    it("imports only the selected module keys", () => {
      seed();
      const preview = previewKnowledgePack(root);
      const result = commitKnowledgeImport(knowledge, preview, { moduleKeys: ["beta"] });

      expect(result.moduleCount).toBe(1);
      expect(knowledge.listModules(result.packIds[0]).map((entry) => entry.moduleKey)).toEqual([
        "beta",
      ]);
    });

    it("replaces a previous import from the same source path", () => {
      seed();
      const preview = previewKnowledgePack(root);
      const first = commitKnowledgeImport(knowledge, preview);
      const second = commitKnowledgeImport(knowledge, preview);

      expect(knowledge.listPacks()).toHaveLength(1);
      expect(second.packIds[0]).not.toBe(first.packIds[0]);
      expect(knowledge.listModules(second.packIds[0])).toHaveLength(2);
      expect(knowledge.listModules(first.packIds[0])).toEqual([]);
    });

    it("rejects a preview whose source content changed", () => {
      seed();
      const preview = previewKnowledgePack(root);
      write("知识/a.md", "---\nmodule: alpha\nname: Alpha\n---\n## Rules\nchanged body");

      expect(() => commitKnowledgeImport(knowledge, preview)).toThrow(/changed/i);
      expect(knowledge.listPacks()).toEqual([]);
    });

    it("rejects an unknown module key", () => {
      seed();
      const preview = previewKnowledgePack(root);
      expect(() =>
        commitKnowledgeImport(knowledge, preview, { moduleKeys: ["missing"] }),
      ).toThrow(/missing/);
    });
  });
});