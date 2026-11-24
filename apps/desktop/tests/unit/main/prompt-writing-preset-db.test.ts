import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PromptWritingPresetDB,
  SCHEMA_TABLES,
  type BuiltinPromptWritingPresetSeed,
} from "@prompthub/db";
import type { SavePromptWritingPresetInput } from "@prompthub/shared/types";
import DatabaseAdapter from "../../../src/main/database/sqlite";

let rawDb: DatabaseAdapter.Database;
let db: PromptWritingPresetDB;

beforeEach(() => {
  rawDb = new DatabaseAdapter(":memory:");
  rawDb.pragma("foreign_keys = ON");
  rawDb.exec(SCHEMA_TABLES);
  db = new PromptWritingPresetDB(rawDb);
});

afterEach(() => rawDb.close());

function input(overrides: Partial<SavePromptWritingPresetInput> = {}): SavePromptWritingPresetInput {
  return {
    name: "My writing guide",
    targetSkill: "moss",
    methodology: "writing-guide",
    validationStatus: "unverified",
    sourceFile: "guide.txt",
    description: "A local guide",
    compressedContent: "## Caption\nWrite coherent prose.",
    originalContent: "## Caption\nWrite coherent prose.\n\nExtra reference.",
    ...overrides,
  };
}

function invalid(value: Record<string, unknown>): SavePromptWritingPresetInput {
  return { ...input(), ...value } as unknown as SavePromptWritingPresetInput;
}

function seed(overrides: Partial<BuiltinPromptWritingPresetSeed> = {}): BuiltinPromptWritingPresetSeed {
  return {
    id: "builtin-test",
    name: "Built-in guide",
    targetSkill: "any",
    methodology: "official-guide",
    sourceFile: "official.htm",
    description: "Shipped preset",
    validationStatus: "unverified",
    compressedContent: "## Rules\nKeep the contract.",
    ...overrides,
  };
}

describe("writing presets", () => {
  it("creates, reads, updates and deletes a user preset", () => {
    const created = db.save(input());
    expect(created.id).toBeTruthy();
    expect(created.builtin).toBe(false);
    expect(created.compressedContent).toContain("coherent prose");
    expect(db.get(created.id)?.name).toBe("My writing guide");

    const updated = db.save(input({ id: created.id, name: "Renamed" }));
    expect(updated.name).toBe("Renamed");
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);

    expect(db.delete(created.id)).toBe(true);
    expect(db.get(created.id)).toBeNull();
    expect(db.delete(created.id)).toBe(false);
  });

  it("keeps built-in presets read-only and idempotent on reseed", () => {
    const first = db.upsertBuiltin(seed());
    expect(first.builtin).toBe(true);
    const second = db.upsertBuiltin(seed());
    expect(second.updatedAt).toBe(first.updatedAt);

    const refreshed = db.upsertBuiltin(seed({ compressedContent: "## Rules\nUpdated." }));
    expect(refreshed.compressedContent).toContain("Updated");

    expect(() => db.save(input({ id: first.id, name: "Hijacked" }))).toThrow(
      "read-only",
    );
    expect(() => db.delete(first.id)).toThrow("cannot be deleted");
  });

  it("does not overwrite a user row that happens to share a built-in id", () => {
    const created = db.save(input({ name: "User row" }));
    const collided = db.upsertBuiltin(seed({ id: created.id }));
    expect(collided.id).toBe(created.id);
    expect(collided.builtin).toBe(false);
    expect(collided.name).toBe("User row");
  });

  it("sorts built-in presets before user presets, then by name", () => {
    db.save(input({ name: "Zeta" }));
    db.save(input({ name: "Alpha" }));
    db.upsertBuiltin(seed({ id: "builtin-b", name: "Built-in B" }));
    db.upsertBuiltin(seed({ id: "builtin-a", name: "Built-in A" }));
    expect(db.list().map((row) => row.name)).toEqual([
      "Built-in A",
      "Built-in B",
      "Alpha",
      "Zeta",
    ]);
  });

  it("rejects invalid targets, methodology, empty content and oversized rows", () => {
    expect(() => db.save(invalid({ targetSkill: "sdxl" }))).toThrow(
      "Unsupported writing preset target",
    );
    expect(() => db.save(invalid({ methodology: "poetry" }))).toThrow(
      "Unsupported writing preset methodology",
    );
    expect(() => db.save(invalid({ validationStatus: "great" }))).toThrow(
      "Unsupported writing preset validation status",
    );
    expect(() => db.save(input({ compressedContent: "   " }))).toThrow(
      "compressed content must be a non-empty string",
    );
    expect(() => db.save(input({ compressedContent: "a\0b" }))).toThrow("null byte");
    expect(() => db.save(input({ compressedContent: "x".repeat(200_001) }))).toThrow(
      "exceeds 200,000 characters",
    );
  });

  it("normalizes line endings and keeps original content optional", () => {
    const created = db.save(
      input({ compressedContent: "## A\r\nbody\r\n", originalContent: null }),
    );
    expect(created.compressedContent).toBe("## A\nbody");
    expect(created.originalContent).toBeNull();
  });
});
