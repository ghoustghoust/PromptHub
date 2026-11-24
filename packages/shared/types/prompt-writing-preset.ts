import type { PromptOrchestrationSkill } from "./prompt-orchestrator";

/**
 * How a writing document is meant to be used. The methodology is metadata for
 * browsing and filtering; it never changes how the text is injected. Rule cards
 * keep the model's output contract, while these presets only describe how to
 * write, how much to write, which dimensions to cover, and from which angle.
 */
export type PromptWritingMethodology =
  | "writing-guide"
  | "unit-template"
  | "official-guide"
  | "reverse-guide";

/** A preset has to be validated against real output before it claims to be. */
export type PromptWritingPresetValidationStatus =
  | "validated"
  | "unverified"
  | "deprecated";

/** `any` keeps prose-level guides usable across rule cards. */
export type PromptWritingPresetTarget = PromptOrchestrationSkill | "any";

/**
 * One heading-delimited slice of a writing document. Section ids are derived
 * from the content, so editing the text may renumber later sections; callers
 * must treat an unknown id as "not selected" instead of failing.
 */
export interface PromptWritingPresetSection {
  id: string;
  title: string;
  charCount: number;
  tokenEstimate: number;
}

export interface PromptWritingPresetSummary {
  id: string;
  name: string;
  targetSkill: PromptWritingPresetTarget;
  methodology: PromptWritingMethodology;
  /** Original file basename, for provenance only; never a runtime path. */
  sourceFile: string | null;
  description: string | null;
  validationStatus: PromptWritingPresetValidationStatus;
  /** Built-in presets are read-only; users copy or import instead of editing. */
  builtin: boolean;
  hasOriginal: boolean;
  originalChars: number | null;
  originalTokenEstimate: number | null;
  compressedChars: number;
  compressedTokenEstimate: number;
  sectionCount: number;
  updatedAt: string;
}

export interface PromptWritingPreset extends PromptWritingPresetSummary {
  originalContent: string | null;
  compressedContent: string;
  originalSections: PromptWritingPresetSection[] | null;
  compressedSections: PromptWritingPresetSection[];
}

export interface SavePromptWritingPresetInput {
  /** Omitted creates a new preset; built-in ids are rejected. */
  id?: string;
  name: string;
  targetSkill: PromptWritingPresetTarget;
  methodology: PromptWritingMethodology;
  sourceFile?: string | null;
  description?: string | null;
  validationStatus?: PromptWritingPresetValidationStatus;
  originalContent?: string | null;
  compressedContent: string;
}

/**
 * Result of reading a local file. The extracted text is the full body; the
 * caller decides what to keep. Nothing is truncated or injected automatically.
 */
export interface ImportedPromptWritingPreset {
  sourceFile: string;
  suggestedName: string;
  format: "text" | "markdown" | "html";
  /** Encoding detected on import, shown so a wrong guess is visible. */
  encoding: "utf-8" | "utf-16le" | "utf-16be" | "gb18030";
  extractedContent: string;
  charCount: number;
  tokenEstimate: number;
  sections: PromptWritingPresetSection[];
}

/**
 * Portable bundle of user presets. Built-ins are shipped with the app and are
 * not exported; importing always creates user-owned copies.
 */
export interface PromptWritingPresetBundleEntry {
  name: string;
  targetSkill: PromptWritingPresetTarget;
  methodology: PromptWritingMethodology;
  sourceFile: string | null;
  description: string | null;
  validationStatus: PromptWritingPresetValidationStatus;
  originalContent: string | null;
  compressedContent: string;
}

export interface PromptWritingPresetBundle {
  version: 1;
  exportedAt: string;
  presets: PromptWritingPresetBundleEntry[];
}

export interface PromptWritingPresetImportResult {
  imported: number;
  skipped: number;
}

export type PromptWritingPresetIPCReply<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };
