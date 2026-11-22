import { v4 as uuidv4 } from "uuid";
import type Database from "./adapter";
import type {
  CreatePromptResultFeedbackDTO,
  PromptResultFeedbackReason,
  PromptResultFeedbackRecord,
  PromptResultRating,
} from "@prompthub/shared/types";

/**
 * Result-level feedback. It records what the user thought of one orchestration
 * result; it never writes back to prompt_terms or upgrades a validation status.
 */
export const PROMPT_FEEDBACK_SCHEMA = `
CREATE TABLE IF NOT EXISTS prompt_orchestration_feedback (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  mode TEXT NOT NULL,
  skill TEXT NOT NULL,
  output_format TEXT,
  guidance_mode TEXT,
  status TEXT NOT NULL CHECK(status IN ('complete', 'degraded')),
  rating TEXT NOT NULL CHECK(rating IN ('usable', 'unusable')),
  reasons_json TEXT NOT NULL,
  note TEXT,
  prompt_excerpt TEXT NOT NULL,
  result_excerpt TEXT NOT NULL,
  snapshot_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_prompt_feedback_time
  ON prompt_orchestration_feedback(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_prompt_feedback_rating
  ON prompt_orchestration_feedback(rating, mode, created_at DESC);
`;

const RATINGS: ReadonlySet<string> = new Set(["usable", "unusable"]);
const REASONS: ReadonlySet<string> = new Set([
  "intent-drift",
  "subject-wrong",
  "too-generic",
  "too-specific",
  "conflicting",
  "style-off",
  "format-broken",
  "other",
]);
const STATUSES: ReadonlySet<string> = new Set(["complete", "degraded"]);
const MAX_REASONS = 8;
const MAX_NOTE = 1000;
const MAX_EXCERPT = 4000;

interface FeedbackRow {
  id: string;
  created_at: number;
  mode: string;
  skill: string;
  output_format: string | null;
  guidance_mode: string | null;
  status: "complete" | "degraded";
  rating: PromptResultRating;
  reasons_json: string;
  note: string | null;
  prompt_excerpt: string;
  result_excerpt: string;
  snapshot_json: string;
}

export function migratePromptFeedback(db: Database.Database): void {
  db.exec(PROMPT_FEEDBACK_SCHEMA);
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

function optionalText(value: unknown, label: string, maxLength: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new Error(`${label} must be a string or null`);
  const text = value.trim();
  if (!text) return null;
  if (text.length > maxLength || text.includes("\0")) {
    throw new Error(`${label} exceeds its length limit or contains a null byte`);
  }
  return text;
}

function parseReasons(value: unknown): PromptResultFeedbackReason[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_REASONS) {
    throw new Error(`Feedback reasons must be an array of at most ${MAX_REASONS} items`);
  }
  return value.map((entry, index) => {
    const reason = requireText(entry, `Feedback reasons[${index}]`, 40);
    if (!REASONS.has(reason)) throw new Error(`Unsupported feedback reason: ${reason}`);
    return reason as PromptResultFeedbackReason;
  });
}

function rowToRecord(row: FeedbackRow): PromptResultFeedbackRecord {
  return {
    id: row.id,
    createdAt: new Date(row.created_at).toISOString(),
    mode: row.mode,
    skill: row.skill,
    outputFormat: row.output_format,
    guidanceMode: row.guidance_mode,
    status: row.status,
    rating: row.rating,
    reasons: JSON.parse(row.reasons_json) as PromptResultFeedbackReason[],
    note: row.note,
    promptExcerpt: row.prompt_excerpt,
    resultExcerpt: row.result_excerpt,
  };
}

export class PromptFeedbackDB {
  constructor(private readonly db: Database.Database) {}

  add(input: CreatePromptResultFeedbackDTO): PromptResultFeedbackRecord {
    const rating = requireText(input.rating, "Feedback rating", 20);
    if (!RATINGS.has(rating)) throw new Error(`Unsupported feedback rating: ${rating}`);
    const status = requireText(input.status, "Feedback result status", 20);
    if (!STATUSES.has(status)) throw new Error(`Unsupported feedback result status: ${status}`);
    const reasons = parseReasons(input.reasons);
    const mode = requireText(input.mode, "Feedback mode", 60);
    const skill = requireText(input.skill, "Feedback skill", 60);
    const promptExcerpt = requireText(input.promptExcerpt, "Feedback prompt excerpt", MAX_EXCERPT);
    const resultExcerpt = requireText(input.resultExcerpt, "Feedback result excerpt", MAX_EXCERPT);
    const note = optionalText(input.note, "Feedback note", MAX_NOTE);
    const outputFormat = optionalText(input.outputFormat, "Feedback output format", 40);
    const guidanceMode = optionalText(input.guidanceMode, "Feedback guidance mode", 40);
    const id = uuidv4();
    const createdAt = Date.now();
    this.db
      .prepare(
        `INSERT INTO prompt_orchestration_feedback (
           id, created_at, mode, skill, output_format, guidance_mode, status,
           rating, reasons_json, note, prompt_excerpt, result_excerpt, snapshot_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        createdAt,
        mode,
        skill,
        outputFormat,
        guidanceMode,
        status,
        rating,
        JSON.stringify(reasons),
        note,
        promptExcerpt,
        resultExcerpt,
        JSON.stringify(input.snapshot ?? null),
      );
    return {
      id,
      createdAt: new Date(createdAt).toISOString(),
      mode,
      skill,
      outputFormat,
      guidanceMode,
      status: status as "complete" | "degraded",
      rating: rating as PromptResultRating,
      reasons,
      note,
      promptExcerpt,
      resultExcerpt,
    };
  }

  list(limit = 50): PromptResultFeedbackRecord[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new Error("Feedback list limit must be an integer from 1 to 500");
    }
    const rows = this.db
      .prepare(
        `SELECT * FROM prompt_orchestration_feedback
          ORDER BY created_at DESC, id DESC LIMIT ?`,
      )
      .all(limit) as FeedbackRow[];
    return rows.map(rowToRecord);
  }
}