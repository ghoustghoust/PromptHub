import { describe, expect, it } from "vitest";
import {
  buildCompositionMessages,
  buildWritingLayerText,
} from "../src/prompt-orchestrator-composition";
import { resolvePromptTaskContract } from "@prompthub/shared/utils/prompt-task-contract";
import { estimatePromptTokens } from "@prompthub/shared/utils/prompt-token-estimate";
import type { PromptOrchestrationInput } from "@prompthub/shared/types";

const PACKAGE_RULE =
  "每场必须包含目标、障碍、转折；场景结尾必须留下可拍摄的动作。";
const STEP_TEXT =
  "INT. 市场街 - 夜\n雨落在雨棚上。信使停下，检查信封封口，远处有人喊他的名字。";

const module = {
  id: "module-script-structure",
  moduleKey: "script-structure",
  title: "剧本结构方法",
  content: PACKAGE_RULE,
  layer: "H" as const,
  packId: "pack-skill-film",
  packName: "Skill-Film",
};

function input(overrides: Partial<PromptOrchestrationInput> = {}): PromptOrchestrationInput {
  return {
    prompt: "写第 3 场剧本",
    mode: "expand",
    skill: "moss",
    outputFormat: "caption",
    ...overrides,
  };
}

function parseUser(messages: { user: string }): Record<string, unknown> {
  return JSON.parse(messages.user) as Record<string, unknown>;
}

describe("package logic vs current-step text", () => {
  it("injects package rules into system without module identity", () => {
    const messages = buildCompositionMessages(input({ knowledgeModules: [module] }), [], []);
    expect(messages.system).toContain(PACKAGE_RULE);
    expect(messages.system).not.toContain("剧本结构方法");
    expect(messages.system).not.toContain("Skill-Film");
    expect(messages.system).not.toContain("[Knowledge module");
    expect(parseUser(messages).intent).toBe("写第 3 场剧本");
  });

  it("dedupes the same module passed twice", () => {
    const messages = buildCompositionMessages(
      input({ knowledgeModules: [module, module] }),
      [],
      [],
    );
    expect(messages.system.split(PACKAGE_RULE).length - 1).toBe(1);
    expect(buildWritingLayerText(input({ knowledgeModules: [module, module] }))
      .split(PACKAGE_RULE).length - 1).toBe(1);
  });

  it("sends current-step text as its own user field, never as intent", () => {
    const messages = buildCompositionMessages(
      input({ prompt: "写第 3 场剧本", stepContext: STEP_TEXT }),
      [],
      [],
    );
    expect(messages.system).not.toContain("雨落在雨棚上");
    const user = parseUser(messages);
    expect(user.stepContext).toBe(STEP_TEXT);
    expect(user.intent).toBe("写第 3 场剧本");
  });

  it("keeps step text out of the intent slot in a rewrite task", () => {
    const messages = buildCompositionMessages(
      input({ mode: "polish", prompt: "润色这一段", stepContext: STEP_TEXT }),
      [],
      [],
    );
    const user = parseUser(messages);
    expect(user.intent).toBe("润色这一段");
    expect(user.stepContext).toBe(STEP_TEXT);
    expect(messages.system).toContain("step material");
  });

  it("declares stepContext as a contract resource", () => {
    const contract = resolvePromptTaskContract(input({ stepContext: STEP_TEXT }));
    expect(contract.resources.stepContext).toMatchObject({
      allowed: true,
      source: "explicit",
      reason: "pipeline-upstream-context",
    });
  });

  it("does not count step text against the writing layer", () => {
    const packageOnly = buildWritingLayerText(input({ knowledgeModules: [module] }));
    const both = buildWritingLayerText(
      input({ knowledgeModules: [module], stepContext: STEP_TEXT }),
    );
    expect(both).toBe(packageOnly);
    expect(both).not.toContain("雨落在雨棚上");
  });

  it("keeps the two paths separate and chargeable when both are present", () => {
    const messages = buildCompositionMessages(
      input({ prompt: STEP_TEXT, stepContext: "OUTLINE: 信使在雨夜送信。", knowledgeModules: [module] }),
      [],
      [],
    );
    expect(messages.system).toContain(PACKAGE_RULE);
    expect(messages.system).not.toContain("雨落在雨棚上");
    expect(parseUser(messages).intent).toBe(STEP_TEXT);
    expect(parseUser(messages).stepContext).toBe("OUTLINE: 信使在雨夜送信。");
    expect(estimatePromptTokens(messages.system)).toBeGreaterThan(0);
  });

  it("applies package rules only when the pack declares the stage", () => {
    const contract = resolvePromptTaskContract(input({ mode: "video-text" }));
    expect(contract.resources.knowledge.allowed).toBe(true);
    expect(contract.resources.knowledge.source).toBe("explicit");
  });
});