import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PromptFeedbackDB, SCHEMA_TABLES } from "@prompthub/db";
import type { CreatePromptResultFeedbackDTO } from "@prompthub/shared/types";
import DatabaseAdapter from "../../../src/main/database/sqlite";

let rawDb: DatabaseAdapter.Database;
let db: PromptFeedbackDB;

beforeEach(() => {
  rawDb = new DatabaseAdapter(":memory:");
  rawDb.pragma("foreign_keys = ON");
  rawDb.exec(SCHEMA_TABLES);
  db = new PromptFeedbackDB(rawDb);
});

afterEach(() => rawDb.close());

function feedback(
  overrides: Partial<CreatePromptResultFeedbackDTO> = {},
): CreatePromptResultFeedbackDTO {
  return {
    mode: "expand",
    skill: "moss",
    outputFormat: "caption",
    guidanceMode: "agent-led",
    status: "complete",
    rating: "usable",
    reasons: ["style-off"],
    note: "soft light was too warm",
    promptExcerpt: "a quiet portrait",
    resultExcerpt: "a quiet portrait in soft light",
    snapshot: { completePrompt: "a quiet portrait in soft light", provenance: [] },
    ...overrides,
  };
}

function invalidFeedback(patch: Record<string, unknown>): CreatePromptResultFeedbackDTO {
  // Deliberately bypasses the type to exercise runtime validation.
  return { ...feedback(), ...patch } as unknown as CreatePromptResultFeedbackDTO;
}

describe("result-level feedback", () => {
  it("stores rating, reasons and note, and lists newest first", () => {
    const first = db.add(feedback());
    const second = db.add(
      feedback({ rating: "unusable", reasons: [], mode: "polish" }) as Parameters<
        PromptFeedbackDB["add"]
      >[0],
    );
    expect(first.id).not.toBe(second.id);
    expect(first).toMatchObject({
      mode: "expand",
      rating: "usable",
      reasons: ["style-off"],
      note: "soft light was too warm",
    });
    const rows = db.list(10);
    expect(rows.map((row) => row.id)).toEqual([second.id, first.id]);
    expect(rows[0].rating).toBe("unusable");
  });

  it("rejects unsupported ratings, reasons and oversized notes", () => {
    expect(() =>
      db.add(invalidFeedback({ rating: "great" })),
    ).toThrow("Unsupported feedback rating");
    expect(() =>
      db.add(invalidFeedback({ reasons: ["cheap"] })),
    ).toThrow("Unsupported feedback reason");
    expect(() =>
      db.add(feedback({ note: "x".repeat(1001) })),
    ).toThrow("length limit");
  });

  it("rejects null bytes and empty excerpts", () => {
    expect(() =>
      db.add(feedback({ note: "bad\0note" })),
    ).toThrow("null byte");
    expect(() =>
      db.add(feedback({ resultExcerpt: "   " })),
    ).toThrow("must be a non-empty string");
  });

  it("keeps feedback independent from term validation", () => {
    db.add(feedback());
    const tables = (
      rawDb.all("SELECT name FROM sqlite_master WHERE type = 'table'") as Array<{ name: string }>
    ).map((row) => row.name);
    expect(tables).toContain("prompt_orchestration_feedback");
    // No write path touches prompt_terms; feedback is an observation record.
    const count = rawDb.get("SELECT COUNT(*) AS count FROM prompt_orchestration_feedback") as {
      count: number;
    };
    expect(count.count).toBe(1);
  });
});