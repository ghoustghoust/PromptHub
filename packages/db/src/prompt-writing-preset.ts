import { v4 as uuidv4 } from "uuid";
import type Database from "./adapter";
import type {
  PromptWritingMethodology,
  PromptWritingPresetTarget,
  PromptWritingPresetValidationStatus,
  SavePromptWritingPresetInput,
} from "@prompthub/shared/types";

/**
 * Writing presets are the user's writable system-prompt layer: "how to write,
 * how much, which dimensions, from which angle". They never define the model's
 * output contract, which stays in the rule cards.
 */
export const PROMPT_WRITING_PRESET_SCHEMA = `
CREATE TABLE IF NOT EXISTS prompt_writing_presets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  target_skill TEXT NOT NULL,
  methodology TEXT NOT NULL,
  source_file TEXT,
  description TEXT,
  validation_status TEXT NOT NULL CHECK(validation_status IN ('validated', 'unverified', 'deprecated')),
  builtin INTEGER NOT NULL DEFAULT 0 CHECK(builtin IN (0, 1)),
  original_content TEXT,
  compressed_content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_prompt_writing_presets_order
  ON prompt_writing_presets(builtin DESC, name COLLATE NOCASE ASC);
`;

export const PROMPT_WRITING_METHODOLOGIES: ReadonlySet<string> = new Set([
  "writing-guide",
  "unit-template",
  "official-guide",
  "reverse-guide",
]);

export const PROMPT_WRITING_VALIDATION_STATUSES: ReadonlySet<string> = new Set([
  "validated",
  "unverified",
  "deprecated",
]);

export const PROMPT_WRITING_TARGETS: ReadonlySet<string> = new Set([
  "moodyMoss",
  "moss",
  "k2",
  "minimaxH3",
  "any",
]);

const MAX_NAME = 120;
const MAX_DESCRIPTION = 500;
const MAX_SOURCE_FILE = 300;
const MAX_CONTENT = 200_000;

export interface PromptWritingPresetRow {
  id: string;
  name: string;
  targetSkill: PromptWritingPresetTarget;
  methodology: PromptWritingMethodology;
  sourceFile: string | null;
  description: string | null;
  validationStatus: PromptWritingPresetValidationStatus;
  builtin: boolean;
  originalContent: string | null;
  compressedContent: string;
  createdAt: number;
  updatedAt: number;
}

export interface BuiltinPromptWritingPresetSeed {
  id: string;
  name: string;
  targetSkill: PromptWritingPresetTarget;
  methodology: PromptWritingMethodology;
  sourceFile: string | null;
  description: string;
  validationStatus: PromptWritingPresetValidationStatus;
  compressedContent: string;
}

interface WritingPresetDbRow {
  id: string;
  name: string;
  target_skill: string;
  methodology: string;
  source_file: string | null;
  description: string | null;
  validation_status: string;
  builtin: number;
  original_content: string | null;
  compressed_content: string;
  created_at: number;
  updated_at: number;
}

export function migratePromptWritingPresets(db: Database.Database): void {
  db.exec(PROMPT_WRITING_PRESET_SCHEMA);
}

function requireText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  const text = value.trim();
  if (text.length > maxLength || text.includes("\0")) {
    throw new Error(`${label} exceeds its length limit or contains a null byte`);
  }
  return text;
}

function optionalText(
  value: unknown,
  label: string,
  maxLength: number,
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new Error(`${label} must be a string or null`);
  const text = value.trim();
  if (!text) return null;
  if (text.length > maxLength || text.includes("\0")) {
    throw new Error(`${label} exceeds its length limit or contains a null byte`);
  }
  return text;
}

function requireEnum<T extends string>(
  value: unknown,
  label: string,
  allowed: ReadonlySet<string>,
): T {
  if (typeof value !== "string" || !allowed.has(value)) {
    throw new Error(`Unsupported ${label}: ${String(value)}`);
  }
  return value as T;
}

/**
 * Content keeps its internal line breaks; only trailing whitespace is removed
 * so section splitting and character counts stay faithful to what was imported.
 */
function requireContent(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  const text = value.replace(/\r\n?/g, "\n").trimEnd();
  if (text.length > MAX_CONTENT) {
    throw new Error(
      `${label} exceeds ${MAX_CONTENT.toLocaleString("en-US")} characters`,
    );
  }
  if (text.includes("\0")) {
    throw new Error(`${label} contains a null byte`);
  }
  return text;
}

function rowToRecord(row: WritingPresetDbRow): PromptWritingPresetRow {
  return {
    id: row.id,
    name: row.name,
    targetSkill: row.target_skill as PromptWritingPresetTarget,
    methodology: row.methodology as PromptWritingMethodology,
    sourceFile: row.source_file,
    description: row.description,
    validationStatus: row.validation_status as PromptWritingPresetValidationStatus,
    builtin: row.builtin === 1,
    originalContent: row.original_content,
    compressedContent: row.compressed_content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PromptWritingPresetDB {
  constructor(private readonly db: Database.Database) {}

  list(): PromptWritingPresetRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM prompt_writing_presets
          ORDER BY builtin DESC, name COLLATE NOCASE ASC, id ASC`,
      )
      .all() as WritingPresetDbRow[];
    return rows.map(rowToRecord);
  }

  get(id: string): PromptWritingPresetRow | null {
    if (typeof id !== "string" || !id.trim()) {
      throw new Error("Writing preset id must be a non-empty string");
    }
    const row = this.db
      .prepare("SELECT * FROM prompt_writing_presets WHERE id = ?")
      .get(id.trim()) as WritingPresetDbRow | undefined;
    return row ? rowToRecord(row) : null;
  }

  save(input: SavePromptWritingPresetInput): PromptWritingPresetRow {
    const name = requireText(input.name, "Writing preset name", MAX_NAME);
    const targetSkill = requireEnum<PromptWritingPresetTarget>(
      input.targetSkill,
      "writing preset target",
      PROMPT_WRITING_TARGETS,
    );
    const methodology = requireEnum<PromptWritingMethodology>(
      input.methodology,
      "writing preset methodology",
      PROMPT_WRITING_METHODOLOGIES,
    );
    const validationStatus = input.validationStatus === undefined
      ? "unverified"
      : requireEnum<PromptWritingPresetValidationStatus>(
          input.validationStatus,
          "writing preset validation status",
          PROMPT_WRITING_VALIDATION_STATUSES,
        );
    const sourceFile = optionalText(input.sourceFile, "Writing preset source file", MAX_SOURCE_FILE);
    const description = optionalText(input.description, "Writing preset description", MAX_DESCRIPTION);
    const compressedContent = requireContent(
      input.compressedContent,
      "Writing preset compressed content",
    );
    const originalContent = input.originalContent === undefined || input.originalContent === null
      ? null
      : requireContent(input.originalContent, "Writing preset original content");

    const now = Date.now();
    const requestedId = typeof input.id === "string" ? input.id.trim() : "";
    if (requestedId) {
      const existing = this.get(requestedId);
      if (!existing) {
        throw new Error(`Writing preset was not found: ${requestedId}`);
      }
      if (existing.builtin) {
        throw new Error("Built-in writing presets are read-only; copy it to edit");
      }
      this.db
        .prepare(
          `UPDATE prompt_writing_presets SET
             name = ?, target_skill = ?, methodology = ?, source_file = ?,
             description = ?, validation_status = ?, original_content = ?,
             compressed_content = ?, updated_at = ?
           WHERE id = ? AND builtin = 0`,
        )
        .run(
          name,
          targetSkill,
          methodology,
          sourceFile,
          description,
          validationStatus,
          originalContent,
          compressedContent,
          now,
          requestedId,
        );
      const updated = this.get(requestedId);
      if (!updated) throw new Error("Writing preset disappeared while saving");
      return updated;
    }

    const id = uuidv4();
    this.db
      .prepare(
        `INSERT INTO prompt_writing_presets (
           id, name, target_skill, methodology, source_file, description,
           validation_status, builtin, original_content, compressed_content,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
      )
      .run(
        id,
        name,
        targetSkill,
        methodology,
        sourceFile,
        description,
        validationStatus,
        originalContent,
        compressedContent,
        now,
        now,
      );
    const created = this.get(id);
    if (!created) throw new Error("Writing preset was not persisted");
    return created;
  }

  /** Imports many presets atomically; ids are always regenerated. */
  importMany(inputs: SavePromptWritingPresetInput[]): PromptWritingPresetRow[] {
    if (inputs.length === 0) return [];
    if (inputs.length > 500) {
      throw new Error("A preset bundle may contain at most 500 entries");
    }
    this.db.exec("BEGIN");
    try {
      const rows = inputs.map((input) => {
        const { id: _ignored, ...rest } = input;
        return this.save(rest);
      });
      this.db.exec("COMMIT");
      return rows;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  delete(id: string): boolean {
    const existing = this.get(id);
    if (!existing) return false;
    if (existing.builtin) {
      throw new Error("Built-in writing presets cannot be deleted");
    }
    this.db.prepare("DELETE FROM prompt_writing_presets WHERE id = ? AND builtin = 0").run(existing.id);
    return true;
  }

  /**
   * Inserts a built-in preset or refreshes it when its shipped text changed.
   * User-owned rows are never overwritten; ids are namespaced `builtin-`.
   */
  upsertBuiltin(seed: BuiltinPromptWritingPresetSeed): PromptWritingPresetRow {
    const existing = this.get(seed.id);
    if (existing && !existing.builtin) {
      return existing;
    }
    const now = Date.now();
    if (
      existing &&
      existing.name === seed.name &&
      existing.targetSkill === seed.targetSkill &&
      existing.methodology === seed.methodology &&
      existing.sourceFile === seed.sourceFile &&
      existing.description === seed.description &&
      existing.validationStatus === seed.validationStatus &&
      existing.compressedContent === seed.compressedContent
    ) {
      return existing;
    }
    if (existing) {
      this.db
        .prepare(
          `UPDATE prompt_writing_presets SET
             name = ?, target_skill = ?, methodology = ?, source_file = ?,
             description = ?, validation_status = ?, builtin = 1,
             compressed_content = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          seed.name,
          seed.targetSkill,
          seed.methodology,
          seed.sourceFile,
          seed.description,
          seed.validationStatus,
          seed.compressedContent,
          now,
          seed.id,
        );
    } else {
      this.db
        .prepare(
          `INSERT INTO prompt_writing_presets (
             id, name, target_skill, methodology, source_file, description,
             validation_status, builtin, original_content, compressed_content,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, NULL, ?, ?, ?)`,
        )
        .run(
          seed.id,
          seed.name,
          seed.targetSkill,
          seed.methodology,
          seed.sourceFile,
          seed.description,
          seed.validationStatus,
          seed.compressedContent,
          now,
          now,
        );
    }
    const saved = this.get(seed.id);
    if (!saved) throw new Error("Built-in writing preset was not persisted");
    return saved;
  }
}
