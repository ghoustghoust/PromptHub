import type Database from "./adapter";
import type {
  PromptOrchestratorWorkspaceState,
  PromptOrchestratorWorkspaceTerm,
} from "@prompthub/shared/types";

/**
 * One durable workspace row for the orchestrator picker: selected/locked/
 * excluded terms plus the model and LoRA archive. Vocabulary content itself
 * stays in prompt_terms; this table only remembers the user's working set.
 */
export const PROMPT_ORCHESTRATOR_STATE_SCHEMA = `
CREATE TABLE IF NOT EXISTS prompt_orchestrator_state (
  id TEXT PRIMARY KEY,
  state_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

export function migratePromptOrchestratorState(db: Database.Database): void {
  db.exec(PROMPT_ORCHESTRATOR_STATE_SCHEMA);
}

const WORKSPACE_ID = "default";
const MAX_STATE_CHARS = 4_000_000;

interface WorkspaceRow {
  state_json: string;
  updated_at: number;
}

export class PromptOrchestratorStateDB {
  constructor(private readonly db: Database.Database) {}

  /**
   * Returns the stored workspace, or null when nothing was saved. A corrupted
   * JSON row is treated as empty state rather than breaking the workbench; the
   * next save replaces it.
   */
  get(): PromptOrchestratorWorkspaceState | null {
    const row = this.db
      .prepare("SELECT state_json, updated_at FROM prompt_orchestrator_state WHERE id = ?")
      .get(WORKSPACE_ID) as WorkspaceRow | undefined;
    if (!row) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.state_json);
    } catch {
      return null;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const value = parsed as Record<string, unknown>;
    const prefabTerms = Array.isArray(value.prefabTerms)
      ? value.prefabTerms as PromptOrchestratorWorkspaceTerm[]
      : [];
    return {
      prefabTerms,
      modelId: typeof value.modelId === "string" ? value.modelId : "",
      loraIds: typeof value.loraIds === "string" ? value.loraIds : "",
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  save(state: PromptOrchestratorWorkspaceState): PromptOrchestratorWorkspaceState {
    const json = JSON.stringify({
      prefabTerms: state.prefabTerms,
      modelId: state.modelId,
      loraIds: state.loraIds,
    });
    if (json.length > MAX_STATE_CHARS) {
      throw new Error("Orchestrator workspace state exceeds its size limit");
    }
    if (json.includes("\0")) {
      throw new Error("Orchestrator workspace state contains a null byte");
    }
    const updatedAt = Date.now();
    this.db
      .prepare(
        `INSERT INTO prompt_orchestrator_state (id, state_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           state_json = excluded.state_json,
           updated_at = excluded.updated_at`,
      )
      .run(WORKSPACE_ID, json, updatedAt);
    return {
      prefabTerms: state.prefabTerms,
      modelId: state.modelId,
      loraIds: state.loraIds,
      updatedAt: new Date(updatedAt).toISOString(),
    };
  }
}