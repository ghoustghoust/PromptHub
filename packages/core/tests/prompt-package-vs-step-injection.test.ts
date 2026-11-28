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
  it("puts package rules in the system prompt with their module header", () => {
    const messages = buildCompositionMessages(input({ knowledgeModules: [module] }), [], []);
    expect(messages.system).toContain(PACKAGE_RULE);
    expect(messages.system).toContain("[Knowledge module: 剧本结构方法");
    expect(messages.system).toContain("pack: Skill-Film");
    expect(parseUser(messages).intent).toBe("写第 3 场剧本");
    expect(parseUser(messages).intent).not.toContain(PACKAGE_RULE);
  });

  it("keeps current-step text in the user message only, never in system", () => {
    const messages = buildCompositionMessages(input({ prompt: STEP_TEXT }), [], []);
    expect(messages.system).not.toContain("雨落在雨棚上");
    expect(parseUser(messages).intent).toBe(STEP_TEXT);
    expect(messages.system).not.toContain("[Knowledge module:");
  });

  it("keeps the two paths separate when both are present", () => {
    const messages = buildCompositionMessages(
      input({ prompt: STEP_TEXT, knowledgeModules: [module] }),
      [],
      [],
    );
    expect(messages.system).toContain(PACKAGE_RULE);
    expect(messages.system).not.toContain("雨落在雨棚上");
    expect(parseUser(messages).intent).toBe(STEP_TEXT);
    expect(parseUser(messages).intent).not.toContain("每场必须");
  });

  it("counts package rules against the writing layer but not step text", () => {
    const packageOnly = buildWritingLayerText(input({ knowledgeModules: [module] }));
    const both = buildWritingLayerText(
      input({ knowledgeModules: [module], prompt: STEP_TEXT }),
    );
    expect(packageOnly).toContain(PACKAGE_RULE);
    expect(packageOnly).not.toContain("雨落在雨棚上");
    expect(both).toBe(packageOnly);
  });

  it("sends package rules once per system prompt, not once per stage", () => {
    const messages = buildCompositionMessages(
      input({ knowledgeModules: [module, module] }),
      [],
      [],
    );
    const occurrences = messages.system.split(PACKAGE_RULE).length - 1;
    expect(occurrences).toBe(2);
    expect(buildWritingLayerText(input({ knowledgeModules: [module, module] }))
      .split(PACKAGE_RULE).length - 1).toBe(2);
  });

  it("charges both paths the same tokens even though their roles differ", () => {
    const packageOnly = buildCompositionMessages(input({ knowledgeModules: [module] }), [], []);
    const stepOnly = buildCompositionMessages(input({ prompt: STEP_TEXT }), [], []);
    const packageTokens = estimatePromptTokens(packageOnly.system) + estimatePromptTokens(packageOnly.user);
    const stepTokens = estimatePromptTokens(stepOnly.system) + estimatePromptTokens(stepOnly.user);
    expect(packageTokens).toBeGreaterThan(stepTokens);
    expect(estimatePromptTokens(stepOnly.system)).toBeLessThan(estimatePromptTokens(packageOnly.system));
  });

  it("has no contract resource for current-step text", () => {
    const contract = resolvePromptTaskContract(input({ prompt: STEP_TEXT }));
    expect(contract.resources.knowledge.allowed).toBe(true);
    expect(contract.resources.systemPromptLayer.allowed).toBe(true);
    expect(Object.keys(contract.resources)).not.toContain("stepText");
    expect(Object.keys(contract.resources)).not.toContain("stepContext");
  });

  it("applies package rules to every task kind without a stage gate", () => {
    const kinds: PromptOrchestrationInput["mode"][] = [
      "expand",
      "polish",
      "video-text",
      "video-short-drama",
    ];
    for (const mode of kinds) {
      const contract = resolvePromptTaskContract(input({ mode }));
      expect(contract.resources.knowledge.allowed).toBe(true);
      expect(contract.resources.knowledge.source).toBe("explicit");
    }
  });
});