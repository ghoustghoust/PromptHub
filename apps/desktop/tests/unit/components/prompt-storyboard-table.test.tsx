import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithI18n } from "../../helpers/i18n";
import { PromptStoryboardTableView } from "../../../src/renderer/components/prompt/PromptStoryboardTableView";

const BOARD = [
  "分镜1 | 大远景 | 平视 | 固定 | 雨夜市场街，信使走入 | 2.5s",
  "分镜2 | 中景 | 略俯 | 缓推 | 信使停在雨棚下，护住信封 | 3.0s",
  "分镜3 | 近景 | 平视 | 固定 | 信封封口特写，水珠滴落 | 2.0s",
].join("\n");

describe("PromptStoryboardTableView", () => {
  it("renders one row per shot with the six column headers", async () => {
    await renderWithI18n(<PromptStoryboardTableView text={BOARD} />, { language: "en" });
    const table = screen.getByTestId("orchestrator-storyboard-table");
    const headers = within(table).getAllByRole("columnheader");
    expect(headers).toHaveLength(6);
    expect(headers.map((header) => header.textContent)).toEqual([
      "Shot",
      "Size",
      "Position",
      "Move",
      "Frame",
      "Duration",
    ]);
    expect(within(table).getByTestId("orchestrator-storyboard-row-2")).toHaveTextContent(
      "信使停在雨棚下，护住信封",
    );
    expect(within(table).getAllByRole("row")).toHaveLength(4);
  });

  it("fills a missing cell with a dash instead of dropping the column", async () => {
    await renderWithI18n(
      <PromptStoryboardTableView text={"分镜1 | 大远景 | 平视 | 固定 | 雨夜市场街"} />,
      { language: "en" },
    );
    const row = screen.getByTestId("orchestrator-storyboard-row-1");
    const cells = within(row).getAllByRole("cell");
    expect(cells).toHaveLength(6);
    expect(cells[5]).toHaveTextContent("—");
  });

  it("renders nothing for a result that is not a storyboard", async () => {
    await renderWithI18n(
      <PromptStoryboardTableView text="一场雨夜的戏，信使等在摊位前。" />,
      { language: "en" },
    );
    expect(screen.queryByTestId("orchestrator-storyboard-table")).toBeNull();
  });
});