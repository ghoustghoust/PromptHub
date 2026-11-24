import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithI18n } from "../../helpers/i18n";
import { PromptOrchestratorResultPanel } from "../../../src/renderer/components/prompt/PromptOrchestratorResultPanel";
import type { OrchestratorStreamingState } from "../../../src/renderer/components/prompt/usePromptOrchestratorWorkbench";

function baseStreaming(overrides: Partial<OrchestratorStreamingState> = {}): OrchestratorStreamingState {
  return {
    runId: "run-1",
    stage: "compose",
    round: 2,
    text: '{"initialPrompt":"a","completePrompt":"a portrait","fields":[]}',
    fields: ["initialPrompt", "completePrompt", "fields"],
    percent: 60,
    mode: "stream",
    firstTokenMs: 120,
    completionTokens: 9,
    tokensPerSecond: 41.5,
    source: "provider",
    ...overrides,
  };
}

function renderPanel(streaming: OrchestratorStreamingState) {
  return renderWithI18n(
    <PromptOrchestratorResultPanel
      result={null}
      sourcePrompt="a portrait"
      skillDraft={null}
      savedSkillId={null}
      isSavingSkill={false}
      onSaveSkill={() => undefined}
      onCopy={() => undefined}
      expanded={false}
      onToggleExpanded={() => undefined}
      savedPromptId={null}
      isSavingToLibrary={false}
      onSaveToLibrary={() => undefined}
      onBackfillTerms={async () => 0}
      streaming={streaming}
      runStats={null}
      onReuseAsIntent={() => undefined}
      onCancel={() => undefined}
      canceling={false}
    />,
  );
}

describe("orchestrator streaming panel", () => {
  it("shows phases, structure, live text and measured stats", async () => {
    renderPanel(baseStreaming());
    expect(await screen.findByTestId("orchestrator-streaming")).toBeTruthy();
    expect(screen.getByText("Composing the prompt")).toBeTruthy();
    expect(screen.getByText("Structure seen").parentElement?.textContent).toContain("60%");
    expect(screen.getByText(/initialPrompt · completePrompt · fields/)).toBeTruthy();
    expect(screen.getByTestId("orchestrator-streaming-text").textContent).toContain(
      '"completePrompt":"a portrait"',
    );
    const stats = screen.getByTestId("orchestrator-streaming-stats").textContent ?? "";
    expect(stats).toContain("First token 120 ms");
    expect(stats).toContain("9 tokens");
    expect(stats).toContain("41.5 tok/s");
    expect(stats).toContain("provider counts");
  });

  it("states plainly when the endpoint did not stream", async () => {
    renderPanel(
      baseStreaming({
        mode: "buffered",
        source: "estimate",
        firstTokenMs: undefined,
        tokensPerSecond: undefined,
        completionTokens: 9,
      }),
    );
    expect(
      await screen.findByText(/This endpoint did not stream, so the whole response arrives at once/),
    ).toBeTruthy();
    expect(screen.getByTestId("orchestrator-streaming-stats").textContent).toContain(
      "estimated counts",
    );
  });
});
