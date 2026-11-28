import { describe, expect, it } from "vitest";
import { resolveStageContract } from "../src/prompt-stage-contract";
import { buildCompositionMessages } from "../src/prompt-orchestrator-composition";
import type { PromptOrchestrationInput } from "@prompthub/shared/types";

function input(overrides: Partial<PromptOrchestrationInput> = {}): PromptOrchestrationInput {
  return {
    prompt: "写第 3 场剧本",
    mode: "expand",
    skill: "k2",
    outputFormat: "caption",
    ...overrides,
  };
}

describe("stage output contract", () => {
  it("requires a scene heading and dialogue for the script stage", () => {
    const contract = resolveStageContract(input({ stage: "script" }));
    expect(contract?.system).toMatch(/scene heading/i);
    expect(contract?.system).toMatch(/INT\./);
    expect(contract?.system).toMatch(/dialogue/i);
    expect(contract?.system).toMatch(/one or two spoken lines/i);
    // The caption one-paragraph shape must not flatten a script page.
    expect(contract?.system).toMatch(/not apply/i);
  });

  it("splits the storyboard into the requested number of shots", () => {
    expect(
      resolveStageContract(input({ stage: "storyboard", prompt: "拆成六个分镜" }))?.requiredShotCount,
    ).toBe(6);
    expect(
      resolveStageContract(input({ stage: "storyboard", prompt: "拆成 8 个分镜" }))?.requiredShotCount,
    ).toBe(8);
    expect(
      resolveStageContract(input({ stage: "storyboard", prompt: "拆成十二镜" }))?.requiredShotCount,
    ).toBe(12);
    expect(
      resolveStageContract(input({ stage: "storyboard", prompt: "拆成分镜" }))?.requiredShotCount,
    ).toBe(6);
  });

  it("prefers the explicit shot count over the intent text", () => {
    const contract = resolveStageContract(
      input({ stage: "storyboard", prompt: "拆成六个分镜", shotCount: 9 }),
    );
    expect(contract?.requiredShotCount).toBe(9);
    expect(contract?.system).toContain("exactly 9");
  });

  it("falls back when the explicit shot count is out of range", () => {
    expect(
      resolveStageContract(input({ stage: "storyboard", prompt: "拆成六个分镜", shotCount: 0 }))
        ?.requiredShotCount,
    ).toBe(6);
    expect(
      resolveStageContract(input({ stage: "storyboard", shotCount: 99 }))?.requiredShotCount,
    ).toBe(6);
  });

  it("names the shot count inside the system text", () => {
    const contract = resolveStageContract(
      input({ stage: "storyboard", prompt: "拆成六个分镜" }),
    );
    expect(contract?.system).toContain("exactly 6");
    expect(contract?.system).toMatch(/do not merge/i);
  });

  it("leaves outline length and ending open to the story", () => {
    const contract = resolveStageContract(input({ stage: "outline" }));
    expect(contract?.system).toMatch(/do not compress/i);
    expect(contract?.system).not.toMatch(/do not resolve/i);
    expect(contract?.system).not.toMatch(/no more than/i);
  });

  it("keeps the unit stage on the requested duration", () => {
    const contract = resolveStageContract(
      input({
        stage: "unit",
        mode: "video-text",
        outputFormat: "h3",
        video: { durationSeconds: 8, shotCount: 3 },
      }),
    );
    expect(contract?.system).toContain("8");
    expect(contract?.system).toMatch(/sound/i);
  });

  it("adds nothing when no stage is declared", () => {
    expect(resolveStageContract(input())).toBeNull();
    const messages = buildCompositionMessages(input(), [], []);
    expect(messages.system).not.toContain("This stage produces");
  });

  it("puts the stage contract into the system prompt only", () => {
    const messages = buildCompositionMessages(input({ stage: "script" }), [], []);
    expect(messages.system).toContain("This stage produces");
    expect(messages.system).toMatch(/scene heading/i);
    const user = JSON.parse(messages.user) as Record<string, unknown>;
    expect(user.intent).toBe("写第 3 场剧本");
    expect(user.stage).toBe("script");
  });
});