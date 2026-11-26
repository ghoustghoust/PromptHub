import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { resolvePromptTaskContract } from "@prompthub/shared/utils/prompt-task-contract";
import { PromptTaskContractPanel } from "../../../src/renderer/components/prompt/PromptTaskContractPanel";
import { renderWithI18n } from "../../helpers/i18n";

describe("PromptTaskContractPanel", () => {
  it("shows which resources the run may use and which input it ignores", async () => {
    const contract = resolvePromptTaskContract({
      mode: "expand",
      skill: "moss",
      outputFormat: "caption",
      video: { durationSeconds: 12 },
    });
    await renderWithI18n(<PromptTaskContractPanel contract={contract} />, {
      language: "en",
    });

    const detail = screen.getByTestId("orchestrator-task-contract-detail");
    expect(detail.textContent).toContain("Task contract");
    expect(detail.textContent).toContain("Creative writing");
    expect(detail.textContent).toContain("Vocabulary");
    expect(detail.textContent).toContain("Layout");
    expect(detail.textContent).toContain("not used");
    expect(
      screen.getByTestId("orchestrator-task-contract-rejected").textContent,
    ).toContain("Video parameters (image task)");
    expect(detail.textContent).toContain(`#${contract.signature}`);
  });

  it("renders a one-line contract summary before a run", async () => {
    const contract = resolvePromptTaskContract({
      mode: "video-text",
      skill: "minimaxH3",
      outputFormat: "h3",
    });
    const { container } = await renderWithI18n(
      <PromptTaskContractPanel contract={contract} compact />,
      { language: "en" },
    );
    const summary = screen.getByTestId("orchestrator-task-contract");
    expect(summary.textContent).toContain("Text to Video");
    expect(summary.textContent).toContain("No model tools");
    expect(summary.textContent).toContain("resource groups allowed");
    expect(container.querySelector("[data-testid='orchestrator-task-contract-detail']"))
      .toBeNull();
  });
});