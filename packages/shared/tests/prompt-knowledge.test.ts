import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  dedupeKnowledgeModules,
  isSkippedKnowledgePath,
  knowledgeModuleSizeError,
  resolveKnowledgeLayer,
} from "@prompthub/shared/utils/prompt-knowledge";

function module(moduleKey: string, contentHash: string) {
  return { moduleKey, contentHash };
}

describe("knowledge pack parsing rules", () => {
  it("maps the seven-section skeleton to P, S and H", () => {
    for (const heading of ["Definition", "Rules", "Quantified Thresholds", "Boundaries"]) {
      assert.equal(resolveKnowledgeLayer(heading), "P", heading);
    }
    for (const heading of ["时间码", "轴线规则", "shot list", "转场", "音效设计"]) {
      assert.equal(resolveKnowledgeLayer(heading), "S", heading);
    }
    for (const heading of ["LUFS 标准", "CPM 预算", "拍摄日排期", "交付清单"]) {
      assert.equal(resolveKnowledgeLayer(heading), "H", heading);
    }
    assert.equal(resolveKnowledgeLayer("随便一段说明"), "H");
  });

  it("rejects a module that is too large in bytes or tokens and accepts a normal one", () => {
    assert.equal(knowledgeModuleSizeError("short module"), null);
    assert.match(knowledgeModuleSizeError("x".repeat(50 * 1024 + 1)) ?? "", /50/);
    const dense = Array.from({ length: 6001 }, () => "字").join(" ");
    assert.match(knowledgeModuleSizeError(dense) ?? "", /6000|token/i);
  });

  it("skips backups, agents and tools but keeps regular knowledge files", () => {
    assert.match(isSkippedKnowledgePath("_备份/skill.md") ?? "", /backup/i);
    assert.match(isSkippedKnowledgePath("知识/老版本.md.bak") ?? "", /backup/i);
    assert.match(isSkippedKnowledgePath("agents/helper.md") ?? "", /agents/);
    assert.match(isSkippedKnowledgePath("tools/run.py") ?? "", /tools/);
    assert.match(isSkippedKnowledgePath("知识/01-叙事/源/动作设计.md") ?? "", /source copy/);
    assert.equal(isSkippedKnowledgePath("知识/镜头语言.md"), null);
    assert.equal(isSkippedKnowledgePath("index.md"), null);
  });

  it("keeps one copy per content hash and reports key conflicts", () => {
    const result = dedupeKnowledgeModules([
      module("intro", "hash-a"),
      module("intro-copy", "hash-a"),
      module("rules", "hash-b"),
      module("rules", "hash-c"),
    ]);
    assert.deepEqual(result.kept.map((entry) => entry.moduleKey), ["intro", "rules"]);
    assert.deepEqual(result.conflicts.map((entry) => entry.reason), [
      "duplicate-content",
      "module-key",
    ]);
  });
});
