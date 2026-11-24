import fs from "node:fs/promises";
import path from "node:path";
import { BUILTIN_PROMPT_WRITING_PRESETS } from "@prompthub/core";
import {
  PromptWritingPresetDB,
  type PromptWritingPresetRow,
} from "@prompthub/db";
import type Database from "@prompthub/db/adapter";
import type {
  ImportedPromptWritingPreset,
  PromptWritingPresetBundle,
  PromptWritingPresetBundleEntry,
  PromptWritingPresetImportResult,
  PromptWritingPreset,
  PromptWritingPresetSection,
  PromptWritingPresetSummary,
  SavePromptWritingPresetInput,
} from "@prompthub/shared/types";
import { estimatePromptTokens } from "@prompthub/shared/utils/prompt-token-estimate";
import {
  extractWritingPresetText,
  splitWritingPresetSections,
} from "./prompt-writing-preset-text";

const MAX_IMPORT_BYTES = 8 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown, label: string, maxLength: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new Error(`${label} must be a string or null`);
  const text = value.trim();
  if (!text) return null;
  if (text.length > maxLength) throw new Error(`${label} exceeds ${maxLength} characters`);
  return text;
}

function parseSaveInput(value: unknown): SavePromptWritingPresetInput {
  if (!isRecord(value)) throw new Error("Writing preset input must be an object");
  return {
    ...(typeof value.id === "string" && value.id.trim() ? { id: value.id.trim() } : {}),
    name: typeof value.name === "string" ? value.name : "",
    targetSkill: value.targetSkill as SavePromptWritingPresetInput["targetSkill"],
    methodology: value.methodology as SavePromptWritingPresetInput["methodology"],
    ...(value.sourceFile !== undefined
      ? { sourceFile: optionalString(value.sourceFile, "Writing preset source file", 300) }
      : {}),
    ...(value.description !== undefined
      ? { description: optionalString(value.description, "Writing preset description", 500) }
      : {}),
    ...(typeof value.validationStatus === "string"
      ? {
          validationStatus:
            value.validationStatus as SavePromptWritingPresetInput["validationStatus"],
        }
      : {}),
    ...(value.originalContent !== undefined
      ? {
          originalContent:
            typeof value.originalContent === "string" ? value.originalContent : null,
        }
      : {}),
    compressedContent:
      typeof value.compressedContent === "string" ? value.compressedContent : "",
  };
}

function summaryOf(row: PromptWritingPresetRow): PromptWritingPresetSummary {
  const compressedSections = splitWritingPresetSections(row.compressedContent);
  const originalSections = row.originalContent
    ? splitWritingPresetSections(row.originalContent)
    : null;
  return {
    id: row.id,
    name: row.name,
    targetSkill: row.targetSkill,
    methodology: row.methodology,
    sourceFile: row.sourceFile,
    description: row.description,
    validationStatus: row.validationStatus,
    builtin: row.builtin,
    hasOriginal: Boolean(row.originalContent),
    originalChars: row.originalContent?.length ?? null,
    originalTokenEstimate: row.originalContent
      ? estimatePromptTokens(row.originalContent)
      : null,
    compressedChars: row.compressedContent.length,
    compressedTokenEstimate: estimatePromptTokens(row.compressedContent),
    sectionCount: compressedSections.length,
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

function presetOf(row: PromptWritingPresetRow): PromptWritingPreset {
  const compressedSections: PromptWritingPresetSection[] =
    splitWritingPresetSections(row.compressedContent);
  return {
    ...summaryOf(row),
    originalContent: row.originalContent,
    compressedContent: row.compressedContent,
    originalSections: row.originalContent
      ? splitWritingPresetSections(row.originalContent)
      : null,
    compressedSections,
  };
}

/**
 * Owns the writing-preset library. Built-ins are refreshed on startup so a
 * shipped improvement reaches existing installs, while user rows stay untouched.
 */
export class DesktopPromptWritingPresetService {
  private readonly presets: PromptWritingPresetDB;

  constructor(db: Database.Database) {
    this.presets = new PromptWritingPresetDB(db);
    this.ensureBuiltins();
  }

  private ensureBuiltins(): void {
    for (const seed of BUILTIN_PROMPT_WRITING_PRESETS) {
      try {
        this.presets.upsertBuiltin(seed);
      } catch (error) {
        // One malformed row must not prevent the app or the other presets from loading.
        console.warn(`Skipping built-in writing preset ${seed.id}`, error);
      }
    }
  }

  list(): PromptWritingPresetSummary[] {
    return this.presets.list().map(summaryOf);
  }

  get(id: unknown): PromptWritingPreset | null {
    if (typeof id !== "string" || !id.trim()) {
      throw new Error("Writing preset id must be a non-empty string");
    }
    const row = this.presets.get(id.trim());
    return row ? presetOf(row) : null;
  }

  save(value: unknown): PromptWritingPreset {
    const input = parseSaveInput(value);
    return presetOf(this.presets.save(input));
  }

  delete(id: unknown): { deleted: boolean } {
    if (typeof id !== "string" || !id.trim()) {
      throw new Error("Writing preset id must be a non-empty string");
    }
    return { deleted: this.presets.delete(id.trim()) };
  }

  /** Decodes UTF-8/UTF-16 BOMs and falls back to GB18030 for older Chinese files. */
  private decodeDocument(buffer: Buffer): {
    text: string;
    encoding: ImportedPromptWritingPreset["encoding"];
  } {
    if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
      return { text: buffer.subarray(3).toString("utf8"), encoding: "utf-8" };
    }
    if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
      return { text: new TextDecoder("utf-16le").decode(buffer.subarray(2)), encoding: "utf-16le" };
    }
    if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
      return { text: new TextDecoder("utf-16be").decode(buffer.subarray(2)), encoding: "utf-16be" };
    }
    try {
      return { text: new TextDecoder("utf-8", { fatal: true }).decode(buffer), encoding: "utf-8" };
    } catch {
      const text = new TextDecoder("gb18030").decode(buffer);
      if (text.includes("\uFFFD")) {
        throw new Error(
          "Writing document is neither UTF-8 nor GB18030. Re-save it as UTF-8 and import again.",
        );
      }
      return { text, encoding: "gb18030" };
    }
  }

  async importFile(filePath: unknown): Promise<ImportedPromptWritingPreset> {
    if (typeof filePath !== "string" || !filePath.trim()) {
      throw new Error("Writing document path must be a non-empty string");
    }
    const resolved = path.resolve(filePath.trim());
    let stats;
    try {
      stats = await fs.stat(resolved);
    } catch {
      throw new Error(`Writing document was not found: ${resolved}`);
    }
    if (!stats.isFile()) throw new Error(`Writing document is not a file: ${resolved}`);
    if (stats.size > MAX_IMPORT_BYTES) {
      throw new Error(
        `Writing document is ${(stats.size / 1024 / 1024).toFixed(1)} MB, above the 8 MB import limit`,
      );
    }
    const decoded = this.decodeDocument(await fs.readFile(resolved));
    const extracted = extractWritingPresetText(resolved, decoded.text);
    return {
      sourceFile: path.basename(resolved),
      suggestedName: extracted.suggestedName,
      format: extracted.format,
      encoding: decoded.encoding,
      extractedContent: extracted.text,
      charCount: extracted.text.length,
      tokenEstimate: estimatePromptTokens(extracted.text),
      sections: splitWritingPresetSections(extracted.text),
    };
  }

  /** User presets only; built-ins ship with the app and are not exported. */
  buildBundle(): PromptWritingPresetBundle {
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      presets: this.presets
        .list()
        .filter((row) => !row.builtin)
        .map((row) => ({
          name: row.name,
          targetSkill: row.targetSkill,
          methodology: row.methodology,
          sourceFile: row.sourceFile,
          description: row.description,
          validationStatus: row.validationStatus,
          originalContent: row.originalContent,
          compressedContent: row.compressedContent,
        })),
    };
  }

  importBundle(value: unknown): PromptWritingPresetImportResult {
    if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.presets)) {
      throw new Error("Writing preset bundle must use version 1 and contain a presets array");
    }
    if (value.presets.length > 500) {
      throw new Error("A preset bundle may contain at most 500 entries");
    }
    const entries: SavePromptWritingPresetInput[] = value.presets.map((raw, index) => {
      if (!isRecord(raw)) throw new Error(`Preset ${index + 1} must be an object`);
      try {
        const parsed = parseSaveInput(raw);
        if (!parsed.name.trim()) throw new Error("name is required");
        if (!parsed.compressedContent.trim()) throw new Error("compressedContent is required");
        return parsed;
      } catch (error) {
        throw new Error(
          `Preset ${index + 1}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
    const rows = this.presets.importMany(entries);
    return { imported: rows.length, skipped: 0 };
  }
}
