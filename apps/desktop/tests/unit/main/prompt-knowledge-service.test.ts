import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { previewKnowledgePack } from "../../../src/main/services/prompt-knowledge-service";

let root: string;

function write(relativePath: string, content: string): void {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "prompthub-knowledge-"));
});

afterEach(() => {
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
});