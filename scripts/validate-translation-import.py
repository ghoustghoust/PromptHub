"""Dry-run validation for the translation workbooks before any database import.

Read-only by construction: workbooks are opened with read_only=True and the
vocabulary database is opened with SQLite mode=ro. Nothing is written back to
either; the only outputs are report.md and report.json in the output directory.

Checks:
1. Workbook structure and status vocabulary.
2. Baseline vs filled diff: row counts, id order, and the columns a reviewer
   must not touch (id, task type, taxonomy, source, en, existing zh, hint).
3. Candidate consistency: 已完成 needs a suggested Chinese value; unfinished
   statuses block an import.
4. Database match: id exists (or the row can be matched by en + category after
   an id re-key), en and category agree, whether zh is overwritten.
5. Value sanity: control characters, whitespace, Latin-only values, length.
6. Coverage: how many currently empty non-artist rows this batch would fill.

Usage (from the repository root):
    python scripts/validate-translation-import.py
    python scripts/validate-translation-import.py --db <prompthub.db> --out <dir>
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[1]

FILES = {
    "review_baseline": "prompt-translation-remaining-review-20261120.xlsx",
    "review_filled": "prompt-translation-remaining-review-20261120-filled.xlsx",
    "tasks_baseline": "prompt-translation-tasks-no-artists-20261120.xlsx",
    "tasks_filled": "prompt-translation-tasks-no-artists-20261120-filled.xlsx",
}

TASK_SHEETS = {
    "review": ["中文字段迁移", "数字符号核对", "已有中文复核"],
    "tasks": ["翻译任务"],
}

HEADERS = [
    "词条ID", "任务类型", "一级分类", "二级分类", "题材域", "来源",
    "英文原文", "当前中文", "建议中文（填写）", "处理状态（填写）",
    "处理人（填写）", "备注（填写）", "处理提示",
]

STATUSES = {"待处理", "已完成", "无需修改", "保留原名", "待修正"}
IMPORT_STATUS = "已完成"
FROZEN_COLUMNS = ["id", "task", "category", "subcategory", "domain", "source", "en", "zh", "hint"]

CJK = re.compile(r"[\u3400-\u9fff]")
CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
MAX_ZH_LENGTH = 60

STAT_LABELS = {
    "candidates": "导入候选（已完成）",
    "noop": "与库中现有中文完全一致（写入无变化）",
    "fills_empty": "会填充当前为空的中文",
    "overwrites": "会覆盖现有中文",
    "missing_in_db": "ID 与 en 均无法匹配",
    "id_drift": "ID 漂移（按 en+分类匹配到新 ID）",
    "en_escape_only": "英文原文仅转义/下划线差异，语义一致",
    "zh_mirrors_en": "建议中文等于英文原文（中文存于 en 字段）",
    "snapshot_drift": "工作簿当前中文与库不一致（快照较旧）",
    "no_cjk": "建议中文不含中日韩字符",
    "whitespace": "建议中文含首尾空白",
    "too_long": "建议中文超过长度上限",
    "control": "建议中文含控制字符",
}


@dataclass
class Issue:
    kind: str
    detail: str
    sheet: str = ""
    row: int = 0
    term_id: str = ""


@dataclass
class Result:
    blockers: list[Issue] = field(default_factory=list)
    warnings: list[Issue] = field(default_factory=list)


def text(value: object) -> str:
    if value is None:
        return ""
    return str(value)


def normalize_en(value: str) -> str:
    """Mirror the corpus normalization: unescape parentheses, fold separators."""
    return re.sub(r"\s+", " ", value.replace("\\", "").replace("_", " ")).strip().lower()


def load_rows(path: Path, sheets: list[str]) -> dict[str, list[dict]]:
    workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        out: dict[str, list[dict]] = {}
        for name in sheets:
            if name not in workbook.sheetnames:
                raise SystemExit(f"{path.name}: missing sheet {name!r}")
            sheet = workbook[name]
            iterator = sheet.iter_rows(values_only=True)
            header = [text(cell) for cell in next(iterator, [])]
            if header[: len(HEADERS)] != HEADERS:
                raise SystemExit(f"{path.name}/{name}: unexpected header {header[:5]}...")
            rows = []
            for index, values in enumerate(iterator, start=2):
                cells = list(values) + [None] * (len(HEADERS) - len(values))
                if all(cell is None or text(cell).strip() == "" for cell in cells):
                    continue
                rows.append({
                    "row": index,
                    "id": text(cells[0]).strip(),
                    "task": text(cells[1]).strip(),
                    "category": text(cells[2]).strip(),
                    "subcategory": text(cells[3]).strip(),
                    "domain": text(cells[4]).strip(),
                    "source": text(cells[5]).strip(),
                    "en": text(cells[6]),
                    "zh": text(cells[7]).strip(),
                    "suggested": text(cells[8]).strip(),
                    "status": text(cells[9]).strip(),
                    "who": text(cells[10]).strip(),
                    "note": text(cells[11]).strip(),
                    "hint": text(cells[12]).strip(),
                })
            out[name] = rows
        return out
    finally:
        workbook.close()


def compare_workbooks(
    result: Result,
    label: str,
    baseline: dict[str, list[dict]],
    filled: dict[str, list[dict]],
) -> None:
    for sheet, base_rows in baseline.items():
        filled_rows = filled.get(sheet, [])
        if len(base_rows) != len(filled_rows):
            result.blockers.append(
                Issue("row-count", f"{label}/{sheet}: baseline {len(base_rows)} vs filled {len(filled_rows)}")
            )
            continue
        for base, filled_row in zip(base_rows, filled_rows):
            if base["id"] != filled_row["id"]:
                result.blockers.append(
                    Issue("row-order", f"{label}/{sheet} row {base['row']} id changed",
                          sheet, base["row"], base["id"])
                )
                continue
            for column in FROZEN_COLUMNS:
                if base[column] == filled_row[column]:
                    continue
                # Excel stores a tag starting with "=" as a formula in one file
                # and as text in the other; the cached value read differs while
                # the cell content does not.
                if column == "en" and base[column] == "" and filled_row[column].startswith("="):
                    result.warnings.append(
                        Issue(
                            "formula-artifact",
                            f"{label}/{sheet} row {base['row']} en read as formula in baseline, "
                            f"text {filled_row[column]!r} in filled",
                            sheet, base["row"], base["id"],
                        )
                    )
                    continue
                result.blockers.append(
                    Issue(
                        "frozen-column",
                        f"{label}/{sheet} row {base['row']} column {column!r}: "
                        f"{base[column]!r} -> {filled_row[column]!r}",
                        sheet, base["row"], base["id"],
                    )
                )


def validate_statuses(result: Result, label: str, rows: list[dict], sheet: str) -> None:
    for row in rows:
        status = row["status"]
        if status == "待处理":
            result.blockers.append(
                Issue("unfinished", f"{label}/{sheet} row {row['row']} is still 待处理",
                      sheet, row["row"], row["id"])
            )
        elif status not in STATUSES:
            result.warnings.append(
                Issue("unrecognized-status",
                      f"{label}/{sheet} row {row['row']} status {status!r} is outside the "
                      "standard vocabulary and will not be imported",
                      sheet, row["row"], row["id"])
            )
        if status == IMPORT_STATUS and not row["suggested"]:
            result.blockers.append(
                Issue("missing-suggestion",
                      f"{label}/{sheet} row {row['row']} is 已完成 without 建议中文",
                      sheet, row["row"], row["id"])
            )
        if status in {"无需修改", "保留原名"} and row["suggested"]:
            result.warnings.append(
                Issue("suggestion-ignored",
                      f"{label}/{sheet} row {row['row']} status {status} carries 建议中文",
                      sheet, row["row"], row["id"])
            )
        if status == "待修正":
            result.warnings.append(
                Issue("pending-fix",
                      f"{label}/{sheet} row {row['row']} is 待修正 and will not be imported",
                      sheet, row["row"], row["id"])
            )


def open_db(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    return connection


def load_db_terms(connection: sqlite3.Connection, ids: set[str]) -> dict[str, sqlite3.Row]:
    found: dict[str, sqlite3.Row] = {}
    ordered = sorted(ids)
    for start in range(0, len(ordered), 500):
        chunk = ordered[start:start + 500]
        placeholders = ",".join("?" for _ in chunk)
        for row in connection.execute(
            f"SELECT id, category, en, zh, domain, validation_status FROM prompt_terms "
            f"WHERE id IN ({placeholders})",
            chunk,
        ):
            found[row["id"]] = row
    return found


def load_terms_by_en(connection: sqlite3.Connection, values: set[str]) -> dict[str, list[sqlite3.Row]]:
    found: dict[str, list[sqlite3.Row]] = defaultdict(list)
    ordered = sorted(values)
    for start in range(0, len(ordered), 200):
        chunk = ordered[start:start + 200]
        placeholders = ",".join("?" for _ in chunk)
        for row in connection.execute(
            f"SELECT id, category, en, zh, domain, validation_status FROM prompt_terms "
            f"WHERE en IN ({placeholders})",
            chunk,
        ):
            found[row["en"]].append(row)
    return found


def load_terms_by_normalized_en(
    connection: sqlite3.Connection, values: set[str]
) -> dict[str, list[sqlite3.Row]]:
    found: dict[str, list[sqlite3.Row]] = defaultdict(list)
    ordered = sorted(values)
    expression = "lower(replace(replace(en, '\\', ''), '_', ' '))"
    for start in range(0, len(ordered), 200):
        chunk = ordered[start:start + 200]
        placeholders = ",".join("?" for _ in chunk)
        for row in connection.execute(
            f"SELECT id, category, en, zh, domain, validation_status FROM prompt_terms "
            f"WHERE {expression} IN ({placeholders})",
            chunk,
        ):
            found[normalize_en(row["en"])].append(row)
    return found


def check_candidates(
    result: Result,
    rows: list[dict],
    terms: dict[str, sqlite3.Row],
    by_en: dict[str, list[sqlite3.Row]],
    by_normalized_en: dict[str, list[sqlite3.Row]],
) -> Counter:
    stats: Counter = Counter()
    for row in rows:
        if row["status"] != IMPORT_STATUS:
            continue
        stats["candidates"] += 1
        term = terms.get(row["id"])
        if term is None:
            # A corpus reimport can re-key an id (prefix or subcategory change)
            # and store escaped parentheses; match by en + category before
            # calling it missing.
            key = normalize_en(row["en"])
            fallback = next(
                (item for item in by_en.get(row["en"], []) if item["category"] == row["category"]),
                None,
            ) or next(
                (item for item in by_normalized_en.get(key, []) if item["category"] == row["category"]),
                None,
            )
            if fallback is None:
                stats["missing_in_db"] += 1
                result.blockers.append(
                    Issue("missing-term",
                          f"row {row['row']} id absent from database and no en match",
                          row["sheet"], row["row"], row["id"])
                )
                continue
            stats["id_drift"] += 1
            same = text(fallback["zh"]).strip() == row["suggested"]
            result.warnings.append(
                Issue(
                    "id-drift",
                    f"row {row['row']}: id not found, matched {fallback['id']} by en"
                    + (" (zh already equal)" if same else
                       f" (zh differs: {text(fallback['zh'])!r} vs {row['suggested']!r})"),
                    row["sheet"], row["row"], row["id"],
                )
            )
            term = fallback

        if normalize_en(term["en"]) != normalize_en(row["en"]):
            stats["en_mismatch"] += 1
            result.blockers.append(
                Issue("en-mismatch",
                      f"row {row['row']}: workbook en {row['en']!r} vs database {term['en']!r}",
                      row["sheet"], row["row"], row["id"])
            )
        elif term["en"] != row["en"]:
            stats["en_escape_only"] += 1
        if term["category"] != row["category"]:
            stats["category_mismatch"] += 1
            result.blockers.append(
                Issue("category-mismatch",
                      f"row {row['row']}: workbook {row['category']!r} vs database {term['category']!r}",
                      row["sheet"], row["row"], row["id"])
            )
        if row["domain"] and term["domain"] != row["domain"]:
            stats["domain_mismatch"] += 1
            result.warnings.append(
                Issue("domain-mismatch",
                      f"row {row['row']}: workbook {row['domain']!r} vs database {term['domain']!r}",
                      row["sheet"], row["row"], row["id"])
            )

        existing = text(term["zh"]).strip()
        proposed = row["suggested"]
        if existing and existing != proposed:
            stats["overwrites"] += 1
            result.warnings.append(
                Issue("overwrite",
                      f"row {row['row']}: existing zh {existing!r} replaced by {proposed!r}",
                      row["sheet"], row["row"], row["id"])
            )
        elif existing == proposed:
            stats["noop"] += 1
        else:
            stats["fills_empty"] += 1

        if not CJK.search(proposed):
            stats["no_cjk"] += 1
            result.warnings.append(
                Issue("no-cjk",
                      f"row {row['row']}: proposed zh has no CJK characters: {proposed!r}",
                      row["sheet"], row["row"], row["id"])
            )
        if CONTROL.search(proposed) or "\n" in proposed or "\r" in proposed:
            stats["control"] += 1
            result.blockers.append(
                Issue("control-char",
                      f"row {row['row']}: proposed zh contains a control character",
                      row["sheet"], row["row"], row["id"])
            )
        if proposed != proposed.strip():
            stats["whitespace"] += 1
            result.warnings.append(
                Issue("whitespace",
                      f"row {row['row']}: proposed zh has leading/trailing whitespace",
                      row["sheet"], row["row"], row["id"])
            )
        if len(proposed) > MAX_ZH_LENGTH:
            stats["too_long"] += 1
            result.warnings.append(
                Issue("too-long",
                      f"row {row['row']}: proposed zh length {len(proposed)}",
                      row["sheet"], row["row"], row["id"])
            )
        if row["zh"] and existing and row["zh"] != existing:
            stats["snapshot_drift"] += 1
            result.warnings.append(
                Issue("snapshot-drift",
                      f"row {row['row']}: workbook 当前中文 {row['zh']!r} vs database {existing!r}",
                      row["sheet"], row["row"], row["id"])
            )
        if proposed == row["en"]:
            stats["zh_mirrors_en"] += 1
    return stats


def count_empty_zh(connection: sqlite3.Connection, ids: list[str]) -> int:
    total = 0
    for start in range(0, len(ids), 500):
        chunk = ids[start:start + 500]
        placeholders = ",".join("?" for _ in chunk)
        total += connection.execute(
            f"SELECT COUNT(*) FROM prompt_terms WHERE id IN ({placeholders}) "
            "AND (zh IS NULL OR TRIM(zh) = '')",
            chunk,
        ).fetchone()[0]
    return total


def coverage(connection: sqlite3.Connection, candidates: list[dict]) -> dict:
    missing_total = connection.execute(
        "SELECT COUNT(*) FROM prompt_terms WHERE category <> 'artist' "
        "AND validation_status <> 'deprecated' AND (zh IS NULL OR TRIM(zh) = '')"
    ).fetchone()[0]
    candidate_ids = sorted({row["id"] for row in candidates})
    would_fill = count_empty_zh(connection, candidate_ids)
    by_category = [
        {"category": category, "count": count}
        for category, count in connection.execute(
            "SELECT category, COUNT(*) FROM prompt_terms WHERE category <> 'artist' "
            "AND validation_status <> 'deprecated' AND (zh IS NULL OR TRIM(zh) = '') "
            "GROUP BY category ORDER BY 2 DESC"
        )
    ]
    return {
        "non_artist_missing_zh": missing_total,
        "candidates": len(candidate_ids),
        "candidates_filling_empty": would_fill,
        "remaining_missing": missing_total - would_fill,
        "remaining_by_category": by_category,
    }


def sample(items: list[Issue], limit: int = 8) -> list[dict]:
    return [
        {"kind": item.kind, "sheet": item.sheet, "row": item.row, "id": item.term_id, "detail": item.detail}
        for item in items[:limit]
    ]


def group(items: list[Issue]) -> dict[str, int]:
    return dict(sorted(Counter(item.kind for item in items).items()))


def render_report(payload: dict) -> str:
    lines: list[str] = []
    add = lines.append
    counts = payload["counts"]
    stats = payload["candidate_stats"]
    add("# 翻译回填 dry-run 报告")
    add("")
    add(f"- 生成时间：{payload['generated_at']}")
    add(f"- 数据库（只读）：`{payload['db']}`")
    add(f"- 结论：**{counts['verdict']}**"
        f"（阻断 {counts['blockers']}，警告 {counts['warnings']}，导入候选 {counts['candidates']}）")
    add("- 本报告由只读脚本生成，未写入工作簿或数据库。")
    add("")

    add("## 一、文件与工作表")
    add("")
    add("| 工作簿 | 工作表 | 数据行 |")
    add("| --- | --- | ---: |")
    for entry in payload["sheets"]:
        add(f"| {entry['file']} | {entry['sheet']} | {entry['rows']} |")
    add("")

    add("## 二、状态分布")
    add("")
    add("| 工作簿 | 工作表 | 已完成 | 无需修改 | 保留原名 | 待修正 | 待处理 | 其他 |")
    add("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |")
    for entry in payload["status_distribution"]:
        row = entry["statuses"]
        add(
            f"| {entry['file']} | {entry['sheet']} | {row.get('已完成', 0)} | "
            f"{row.get('无需修改', 0)} | {row.get('保留原名', 0)} | "
            f"{row.get('待修正', 0)} | {row.get('待处理', 0)} | {row.get('other', 0)} |"
        )
    add("")

    add("## 三、与未填写版本的差异")
    add("")
    for line in payload["baseline_diff"]:
        add(f"- {line}")
    add("")

    add("## 四、导入候选与库内现状")
    add("")
    add("| 项目 | 数量 |")
    add("| --- | ---: |")
    for key, value in payload["candidate_stats"].items():
        add(f"| {STAT_LABELS.get(key, key)} | {value} |")
    add("")
    if payload["already_applied"]:
        add("**库中已是这批译名**：绝大多数候选与现有中文完全一致，直接导入只产生无变化写入。")
        add("")
    if stats.get("overwrites", 0) and stats.get("id_drift", 0):
        add("注：覆盖计数来自 ID 漂移行——原 ID 已不存在，按 en+分类匹配到新 ID 后译名不同，需人工判断保留哪一个。")
        add("")

    add("## 五、阻断问题")
    add("")
    if not payload["blockers"]:
        add("无。")
    else:
        add("| 类型 | 数量 |")
        add("| --- | ---: |")
        for kind, value in payload["blocker_groups"].items():
            add(f"| {kind} | {value} |")
        add("")
        add("示例：")
        add("")
        for item in payload["blockers"]:
            add(f"- `{item['kind']}` {item['sheet']} 第 {item['row']} 行 `{item['id']}`：{item['detail']}")
    add("")

    add("## 六、需要人工确认")
    add("")
    if not payload["focus"]:
        add("无。")
    else:
        for item in payload["focus"]:
            add(f"- `{item['kind']}` {item['sheet']} 第 {item['row']} 行 `{item['id']}`：{item['detail']}")
    add("")

    add("## 七、警告")
    add("")
    if not payload["warnings"]:
        add("无。")
    else:
        add("| 类型 | 数量 |")
        add("| --- | ---: |")
        for kind, value in payload["warning_groups"].items():
            add(f"| {kind} | {value} |")
        add("")
        add("示例：")
        add("")
        for item in payload["warnings"]:
            add(f"- `{item['kind']}` {item['sheet']} 第 {item['row']} 行 `{item['id']}`：{item['detail']}")
    add("")

    add("## 八、覆盖情况")
    add("")
    add(f"- 库中非画师、未废弃且缺少中文：{payload['coverage']['non_artist_missing_zh']}")
    add(f"- 本批候选词条：{payload['coverage']['candidates']}")
    add(f"- 候选会填充的空中文：{payload['coverage']['candidates_filling_empty']}")
    add(f"- 导入后仍缺中文：{payload['coverage']['remaining_missing']}")
    if payload["coverage"]["remaining_by_category"]:
        add("")
        add("仍缺中文的分类：")
        add("")
        for entry in payload["coverage"]["remaining_by_category"][:8]:
            add(f"- {entry['category']}：{entry['count']}")
    add("")

    add("## 九、边界")
    add("")
    add("- 脚本以 `mode=ro` 打开数据库，工作簿以 `read_only=True` 打开；没有写入、备份替换或迁移。")
    add("- 只校验工作簿与当前隔离库的一致性，不判断译名质量。")
    add("- 词条 ID 是首选导入键；ID 缺失时按 en + 分类回退匹配，命中的记为警告而不是阻断。")
    add("- `待修正` 与 `待处理` 一律不进入导入；非标准状态同样不导入，并在警告中列出。")
    add("")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=os.path.join(
        os.environ.get("TEMP", ""), "qwenwork", "PromptHub-native-manual-test",
        "profile", "data", "prompthub.db"))
    parser.add_argument("--out", default=str(ROOT / "outputs" / "translation-import-dryrun-20261121"))
    args = parser.parse_args()

    db_path = Path(args.db)
    if not db_path.exists():
        raise SystemExit(f"database not found: {db_path}")
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    result = Result()
    sheets_report: list[dict] = []
    status_report: list[dict] = []
    baseline_lines: list[str] = []
    all_rows: list[dict] = []
    candidates: list[dict] = []

    filled: dict[str, dict[str, list[dict]]] = {}
    for kind, sheets in (("review", TASK_SHEETS["review"]), ("tasks", TASK_SHEETS["tasks"])):
        filled_path = ROOT / FILES[f"{kind}_filled"]
        filled[kind] = load_rows(filled_path, sheets)
        for sheet, rows in filled[kind].items():
            for row in rows:
                row["sheet"] = sheet
            sheets_report.append({"file": filled_path.name, "sheet": sheet, "rows": len(rows)})
            validate_statuses(result, kind, rows, sheet)
            statuses = Counter(row["status"] or "(blank)" for row in rows)
            known = sum(value for key, value in statuses.items() if key in STATUSES)
            status_report.append({
                "file": filled_path.name,
                "sheet": sheet,
                "statuses": {**dict(statuses), "other": len(rows) - known},
            })
            all_rows.extend(rows)
            candidates.extend(row for row in rows if row["status"] == IMPORT_STATUS)

        baseline_path = ROOT / FILES[f"{kind}_baseline"]
        if baseline_path.exists():
            baseline = load_rows(baseline_path, sheets)
            compare_workbooks(result, kind, baseline, filled[kind])
            baseline_lines.append(
                f"{kind}: 已与 {baseline_path.name} 逐行比对（行数、ID 顺序、9 个只读列）。"
            )
        else:
            baseline_lines.append(f"{kind}: 未找到 {baseline_path.name}，跳过基线比对。")

    id_counts = Counter(row["id"] for row in all_rows)
    for term_id, count in id_counts.items():
        if count <= 1:
            continue
        rows = [row for row in all_rows if row["id"] == term_id]
        result.blockers.append(
            Issue("duplicate-id", f"{term_id} appears {count} times across workbooks",
                  rows[0]["sheet"], rows[0]["row"], term_id)
        )

    connection = open_db(db_path)
    try:
        terms = load_db_terms(connection, set(id_counts))
        missing_en = {row["en"] for row in candidates if row["id"] not in terms}
        by_en = load_terms_by_en(connection, missing_en)
        by_normalized_en = load_terms_by_normalized_en(
            connection, {normalize_en(value) for value in missing_en}
        )
        candidate_stats = check_candidates(result, candidates, terms, by_en, by_normalized_en)
        coverage_stats = coverage(connection, candidates)
    finally:
        connection.close()

    verdict = "阻断" if result.blockers else "可导入"
    if not result.blockers and candidate_stats.get("noop", 0) >= max(1, len(candidates) - 2):
        verdict = "可导入，库中已是这批译名（预计无实际写入）"

    payload = {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "db": str(db_path),
        "counts": {
            "verdict": verdict,
            "blockers": len(result.blockers),
            "warnings": len(result.warnings),
            "candidates": len(candidates),
        },
        "sheets": sheets_report,
        "status_distribution": status_report,
        "baseline_diff": baseline_lines,
        "candidate_stats": dict(sorted(candidate_stats.items())),
        "already_applied": candidate_stats.get("noop", 0) > 0 and candidate_stats.get("fills_empty", 0) == 0,
        "coverage": coverage_stats,
        "blocker_groups": group(result.blockers),
        "warning_groups": group(result.warnings),
        "blockers": sample(result.blockers),
        "warnings": sample(result.warnings),
        "focus": [
            {"kind": item.kind, "sheet": item.sheet, "row": item.row, "id": item.term_id, "detail": item.detail}
            for item in [*result.blockers, *result.warnings]
            if item.kind in {"id-drift", "overwrite", "unrecognized-status", "frozen-column",
                             "en-mismatch", "missing-term"}
        ],
        "blockers_total": len(result.blockers),
        "warnings_total": len(result.warnings),
    }

    (out_dir / "report.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    (out_dir / "report.md").write_text(render_report(payload), encoding="utf-8")
    print(json.dumps({
        "out": str(out_dir),
        "verdict": verdict,
        "blockers": len(result.blockers),
        "warnings": len(result.warnings),
        "candidates": len(candidates),
        "noop": candidate_stats.get("noop", 0),
        "id_drift": candidate_stats.get("id_drift", 0),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
