import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PromptReferenceItem } from "@prompthub/shared/types";
import { PromptReferencePicker } from "../../../src/renderer/components/prompt/PromptReferencePicker";
import { renderWithI18n } from "../../helpers/i18n";

function reference(index: number): PromptReferenceItem {
  return {
    id: `ref-${index}`,
    nameZh: `导演${index}`,
    category: index < 3 ? "黑色悬疑" : "东方美学",
    summary: "冷调",
    palette: ["#112233"],
    style: { avoid: [] },
    thumbnailPath: `ref-${index}.jpg`,
    sourcePath: `G:\\packs\\ref-${index}`,
    sourceHash: `hash-${index}`,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("PromptReferencePicker", () => {
  it("toggles cards and disables a fourth selection", async () => {
    const onToggle = vi.fn();
    await renderWithI18n(
      <PromptReferencePicker
        items={[1, 2, 3, 4].map(reference)}
        selectedIds={["ref-1", "ref-2", "ref-3"]}
        onToggle={onToggle}
      />,
      { language: "en" },
    );

    expect(screen.getByTestId("reference-selected-count").textContent).toContain("3 / 3");
    expect(screen.getByTestId("reference-card-ref-4")).toBeDisabled();
    fireEvent.click(screen.getByTestId("reference-card-ref-2"));
    expect(onToggle).toHaveBeenCalledWith("ref-2");
    expect(screen.getByTestId("reference-selected-chips")).toBeTruthy();
  });
});