import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PromptAlignment } from "@prompthub/shared/types";
import { PromptComparisonView } from "../../../src/renderer/components/prompt/PromptComparisonView";
import { renderWithI18n } from "../../helpers/i18n";

const alignment: PromptAlignment = {
  method: "sentence-match",
  leftSegments: [
    { id: "l0", text: "一个女孩坐在窗边。" },
    { id: "l1", text: "窗外下着雨。" },
  ],
  rightSegments: [
    { id: "r0", text: "一位少女坐在木窗旁。" },
    { id: "r1", text: "雨点敲打窗棂，空气潮湿。" },
  ],
  rows: [
    { id: "row-r0", leftId: "l0", rightId: "r0", isNew: false },
    { id: "row-r1", leftId: "l1", rightId: "r1", isNew: false },
  ],
};

const source = "一个女孩坐在窗边。窗外下着雨。";
const generated = "一位少女坐在木窗旁。雨点敲打窗棂，空气潮湿。";

describe("PromptComparisonView", () => {
  it("renders source and generated text side by side", async () => {
    await renderWithI18n(
      <PromptComparisonView
        source={source}
        generated={generated}
        alignment={alignment}
      />,
    );
    expect(screen.getByText("一个女孩坐在窗边。")).toBeTruthy();
    expect(screen.getByText("雨点敲打窗棂，空气潮湿。")).toBeTruthy();
  });

  it("highlights the linked source sentence when a generated sentence is selected", async () => {
    const { container } = await renderWithI18n(
      <PromptComparisonView
        source={source}
        generated={generated}
        alignment={alignment}
      />,
    );
    expect(container.querySelectorAll('[data-active="true"]')).toHaveLength(0);
    fireEvent.click(screen.getByText("雨点敲打窗棂，空气潮湿。"));
    const active = container.querySelectorAll('[data-active="true"]');
    expect(active).toHaveLength(1);
    expect(active[0].textContent).toContain("窗外下着雨。");
  });

  it("falls back to plain columns without alignment", async () => {
    await renderWithI18n(
      <PromptComparisonView source="原始想法" generated="生成结果" />,
    );
    expect(screen.getByText("原始想法")).toBeTruthy();
    expect(screen.getByText("生成结果")).toBeTruthy();
  });
});
