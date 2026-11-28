import { describe, expect, it } from "vitest";
import type { PromptOrchestrationInput } from "@prompthub/shared/types";
import { resolvePromptTaskContract } from "@prompthub/shared/utils/prompt-task-contract";
import { buildRunLoad } from "../src/prompt-run-load";

const IMAGE = "data:image/jpeg;base64,AAAA";

function input(overrides: Partial<PromptOrchestrationInput> = {}): PromptOrchestrationInput {
  return {
    prompt: "A reader by a tall window",
    mode: "polish",
    skill: "moss",
    outputFormat: "caption",
    guidanceMode: "agent-led",
    systemPromptLayerContextSize: 32768,
    ...overrides,
  };
}

describe("run load breakdown", () => {
  it("prices every layer separately and sums to the prompt total", () => {
    const value = input({
      systemPromptLayer: "House style: restrained lighting, no captions.",
      knowledgeModules: [
        {
          id: "m1",
          moduleKey: "k1",
          title: "Camera language",
          content: "Prefer motivated light and a single clear subject.",
        },
      ],
      referenceStyles: [
        {
          id: "r1",
          nameZh: "导演",
          category: "冷调",
          summary: "冷绿色调，低饱和",
          palette: ["#112233"],
        },
      ],
      imageUrls: [IMAGE],
    });
    const load = buildRunLoad({
      input: value,
      contract: resolvePromptTaskContract(value),
      completionTokens: 320,
      retrieval: { rounds: 2, queryCount: 4, candidateCount: 8 },
      historyTokens: 1500,
      elapsedMs: 8400,
      toolCalls: 2,
    });

    expect(load.method).toBe("estimate");
    expect(load.breakdown.ruleCard).toBeGreaterThan(0);
    expect(load.breakdown.contract).toBeGreaterThan(0);
    expect(load.breakdown.writingLayer).toBeGreaterThan(0);
    expect(load.breakdown.knowledge).toBeGreaterThan(0);
    expect(load.breakdown.reference).toBeGreaterThan(0);
    expect(load.breakdown.images).toBe(1024);
    expect(load.breakdown.history).toBe(1500);
    const sum = Object.values(load.breakdown).reduce((total, part) => total + part, 0);
    expect(load.promptTokens).toBe(sum);
    expect(load.totalTokens).toBe(load.promptTokens + 320);
    expect(load.rounds).toBe(2);
    expect(load.candidates).toBe(8);
    expect(load.elapsedMs).toBe(8400);
  });

  it("keeps unused layers at zero", () => {
    const value = input({ mode: "expand", guidanceMode: "human-led" });
    const load = buildRunLoad({
      input: value,
      contract: resolvePromptTaskContract(value),
      completionTokens: 120,
      elapsedMs: 1000,
      toolCalls: 0,
    });

    expect(load.breakdown.writingLayer).toBe(0);
    expect(load.breakdown.knowledge).toBe(0);
    expect(load.breakdown.reference).toBe(0);
    expect(load.breakdown.images).toBe(0);
    expect(load.breakdown.history).toBe(0);
    expect(load.breakdown.ruleCard).toBeGreaterThan(0);
    expect(load.promptTokens).toBeGreaterThan(load.breakdown.ruleCard);
  });

  it("reports the rule card difference between content ranges", () => {
    const base = buildRunLoad({
      input: input(),
      contract: resolvePromptTaskContract(input()),
      completionTokens: 0,
      elapsedMs: 0,
      toolCalls: 0,
    });
    const adultInput = input({ skill: "k2", allowAdult: true });
    const adult = buildRunLoad({
      input: adultInput,
      contract: resolvePromptTaskContract(adultInput),
      completionTokens: 0,
      elapsedMs: 0,
      toolCalls: 0,
    });
    expect(base.breakdown.ruleCard).toBeGreaterThan(0);
    expect(adult.breakdown.ruleCard).toBeGreaterThan(0);
  });
});