import type Database from "./adapter";

/**
 * One durable row for the script flow: stage version chains plus the upstream
 * version each text was written against. The flow is a task structure, so it is
 * stored whole rather than spread across the prompt library.
 *
 * Parsing lives in the service (core owns the flow rules); this layer only
 * keeps the JSON, so the db package does not depend on core.
 */
export const PROMPT_SCRIPT_FLOW_SCHEMA = `
CREATE TABLE IF NOT EXISTS prompt_script_flow (
  id TEXT PRIMARY KEY,
  flow_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

export function migratePromptScriptFlow(db: Database.Database): void {
  db.exec(PROMPT_SCRIPT_FLOW_SCHEMA);
}

const FLOW_ID = "default";
const MAX_FLOW_CHARS = 2_000_000;

interface FlowRow {
  flow_json: string;
  updated_at: number;
}

export class PromptScriptFlowDB {
  constructor(private readonly db: Database.Database) {}

  /** Raw stored JSON, or null when absent or unreadable. */
  get(): unknown {
    const row = this.db.get(
      "SELECT flow_json, updated_at FROM prompt_script_flow WHERE id = ?",
      [FLOW_ID],
    ) as FlowRow | undefined;
    if (!row) return null;
    try {
      return JSON.parse(row.flow_json);
    } catch {
      return null;
    }
  }

  save(value: unknown): unknown {
    const json = JSON.stringify(value);
    if (json.length > MAX_FLOW_CHARS) {
      throw new Error("Script flow exceeds its size limit");
    }
    this.db
      .prepare(
        `INSERT INTO prompt_script_flow (id, flow_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           flow_json = excluded.flow_json,
           updated_at = excluded.updated_at`,
      )
      .run(FLOW_ID, json, Date.now());
    return value;
  }
}