import { describe, expect, it } from "vitest";
import { inspectStoryboardShape, parseStoryboardRows } from "../src/prompt-storyboard-shape";

const row = (index: number, fields = 6) =>
  `分镜${index} | ${Array.from({ length: fields - 1 }, (_, column) => `c${column}`).join(" | ")}`;

describe("parseStoryboardRows", () => {
  it("reads six pipe fields per shot line", () => {
    const rows = parseStoryboardRows(`${row(1)}\n${row(2)}`);
    expect(rows).toHaveLength(2);
    expect(rows[0].number).toBe(1);
    expect(rows[0].fields).toHaveLength(6);
    expect(rows[0].fields[0]).toBe("分镜1");
  });

  it("ignores prose around the shot lines", () => {
    const rows = parseStoryboardRows(`下面是分镜：\n${row(1)}\n\n收尾说明。`);
    expect(rows.map((item) => item.number)).toEqual([1]);
  });
});

describe("inspectStoryboardShape", () => {
  it("stays quiet when the count and columns match", () => {
    const report = inspectStoryboardShape(`${row(1)}\n${row(2)}\n${row(3)}`, 3);
    expect(report.rows).toHaveLength(3);
    expect(report.issues).toEqual([]);
  });

  it("reports fewer shots than configured", () => {
    const report = inspectStoryboardShape(`${row(1)}\n${row(2)}`, 6);
    expect(report.issues.join(" ")).toContain("2 shot lines");
    expect(report.issues.join(" ")).toContain("6 shots");
  });

  it("reports a line with missing columns and names it", () => {
    const report = inspectStoryboardShape(`${row(1)}\n${row(2, 5)}`, 2);
    const text = report.issues.join(" ");
    expect(text).toContain("分镜2");
    expect(text).toContain("5 fields");
    expect(text).toContain("six");
  });

  it("reports a markdown header or separator row", () => {
    const report = inspectStoryboardShape(
      `| 镜号 | 景别 | 机位 | 运镜 | 画面 | 时长 |\n| --- | --- | --- | --- | --- | --- |\n${row(1)}`,
      1,
    );
    expect(report.issues.join(" ")).toMatch(/header|separator/i);
  });

  it("reports an output with no shot lines at all", () => {
    const report = inspectStoryboardShape("一场雨夜的戏，信使等在摊位前。", 6);
    expect(report.issues.join(" ")).toMatch(/no storyboard shot lines/i);
  });

  it("reports numbering that is not 1..N in order", () => {
    const report = inspectStoryboardShape(`${row(1)}\n${row(3)}`, 2);
    expect(report.issues.join(" ")).toMatch(/numbered 1/);
  });

  it("does not judge the count when none was requested", () => {
    const report = inspectStoryboardShape(`${row(1)}`, null);
    expect(report.issues).toEqual([]);
  });
});