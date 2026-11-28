/**
 * Storyboard shape: the stage contract asks for one `分镜N | …` line per shot
 * with six fixed columns. The model does not always obey, so the output is
 * inspected deterministically. Issues are reported as warnings; the text is
 * never rewritten or truncated.
 */

export const STORYBOARD_COLUMN_COUNT = 6;

export interface StoryboardRow {
  /** Shot number from the `分镜N` prefix. */
  number: number;
  /** The six cells, in contract order. */
  fields: string[];
  text: string;
}

export interface StoryboardShapeReport {
  rows: StoryboardRow[];
  expectedShots: number | null;
  /** User-facing warnings; empty when the shape matches the contract. */
  issues: string[];
}

const ROW_PATTERN = /^分镜\s*(\d+)\s*\|(.*)$/;
const MAX_ISSUES = 4;

function isSeparatorOrHeader(line: string): boolean {
  return /^\|/.test(line) || /\|\s*:?-{3,}/.test(line);
}

/** Shot lines only; prose, blank lines and markdown headers are skipped. */
export function parseStoryboardRows(text: string): StoryboardRow[] {
  const rows: StoryboardRow[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const match = ROW_PATTERN.exec(line);
    if (!match) continue;
    const number = Number.parseInt(match[1], 10);
    if (!Number.isFinite(number)) continue;
    rows.push({
      number,
      fields: line.split("|").map((field) => field.trim()),
      text: line,
    });
  }
  return rows;
}

/**
 * Compares the produced storyboard with the contract. `expectedShots` comes from
 * the same resolver the stage contract uses, so both speak about one number.
 */
export function inspectStoryboardShape(
  text: string,
  expectedShots: number | null,
): StoryboardShapeReport {
  const rows = parseStoryboardRows(text);
  const issues: string[] = [];
  const lines = text.split(/\r?\n/).map((line) => line.trim());

  if (lines.some((line) => line && isSeparatorOrHeader(line))) {
    issues.push(
      "The storyboard contains a table header or separator row; only `分镜N | 景别 | 机位/角度 | 运镜 | 画面 | 时长` lines are expected.",
    );
  }

  if (rows.length === 0) {
    issues.push(
      "No storyboard shot lines were found; expected one `分镜N | 景别 | 机位/角度 | 运镜 | 画面 | 时长` line per shot.",
    );
    return { rows, expectedShots, issues };
  }

  if (expectedShots !== null && rows.length !== expectedShots) {
    issues.push(
      `The storyboard has ${rows.length} shot lines but ${expectedShots} shots were configured; the text was not changed.`,
    );
  }

  const shortRows = rows.filter((row) => row.fields.length !== STORYBOARD_COLUMN_COUNT);
  for (const row of shortRows.slice(0, 2)) {
    issues.push(
      `Shot 分镜${row.number} has ${row.fields.length} fields; six are required (镜号 | 景别 | 机位/角度 | 运镜 | 画面 | 时长).`,
    );
  }

  const ordered = rows.every((row, index) => row.number === index + 1);
  if (!ordered) {
    issues.push(`Storyboard shot numbers are not numbered 1…${rows.length} in order.`);
  }

  return { rows, expectedShots, issues: issues.slice(0, MAX_ISSUES) };
}