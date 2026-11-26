import type Database from "./adapter";
import type {
  PromptMossLayoutDraft,
  PromptOrchestratorWorkspaceState,
  PromptOrchestratorWorkspaceTerm,
} from "@prompthub/shared/types";
import { MAX_WRITING_LAYER_CHARS } from "@prompthub/shared/utils/prompt-orchestrator-limits";

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
const MAX_SECTION_IDS = 200;
/** Materials marked in the picture library; the list only grows with the grid. */
const MAX_SELECTED_ASSET_IDS = 500;

interface WorkspaceRow {
  state_json: string;
  updated_at: number;
}

/** Read path: keep whatever was stored verbatim; the service validates it. */
function optionalLayerText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function optionalId(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" && value.trim() ? value.slice(0, 200) : undefined;
}

function sectionIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .slice(0, MAX_SECTION_IDS);
}

/** Knowledge selections use the same bounded string-list shape as sections. */
function knowledgeIds(value: unknown): string[] | undefined {
  return sectionIds(value);
}

/**
 * Write path: an oversized writing layer is an error, never a silent slice.
 * The cap matches the core transport guard, so anything longer could not run.
 */
function persistedLayerText(value: string): string {
  if (value.length > MAX_WRITING_LAYER_CHARS) {
    throw new Error(
      `Orchestrator writing layer is ${value.length} characters; the limit is ${MAX_WRITING_LAYER_CHARS}`,
    );
  }
  if (value.includes("\0")) {
    throw new Error("Orchestrator writing layer contains a null byte");
  }
  return value;
}

/** Read path only; the canvas draft shape is validated by the service. */
function layoutDraft(value: unknown): PromptMossLayoutDraft | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const candidate = value as Partial<PromptMossLayoutDraft>;
  return candidate.version === 1 && Array.isArray(candidate.boxes)
    ? candidate as PromptMossLayoutDraft
    : undefined;
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
    const layerText = optionalLayerText(value.systemLayerText);
    const layout = layoutDraft(value.mossLayout);
    return {
      prefabTerms,
      modelId: typeof value.modelId === "string" ? value.modelId : "",
      loraIds: typeof value.loraIds === "string" ? value.loraIds : "",
      ...(layerText !== undefined ? { systemLayerText: layerText } : {}),
      ...(optionalId(value.systemLayerSource) !== undefined
        ? { systemLayerSource: optionalId(value.systemLayerSource) }
        : {}),
      ...(optionalId(value.writingPresetId) !== undefined
        ? { writingPresetId: optionalId(value.writingPresetId) }
        : {}),
      ...(value.writingPresetVariant === "compressed" || value.writingPresetVariant === "original"
        ? { writingPresetVariant: value.writingPresetVariant }
        : {}),
      ...(sectionIds(value.writingPresetSectionIds) !== undefined
        ? { writingPresetSectionIds: sectionIds(value.writingPresetSectionIds) }
        : {}),
      ...(layout !== undefined ? { mossLayout: layout } : {}),
      ...(knowledgeIds(value.knowledgePackIds) !== undefined
        ? { knowledgePackIds: knowledgeIds(value.knowledgePackIds) }
        : {}),
      ...(knowledgeIds(value.knowledgeModuleIds) !== undefined
        ? { knowledgeModuleIds: knowledgeIds(value.knowledgeModuleIds) }
        : {}),
      ...(value.knowledgeContractGroup === "script" ||
      value.knowledgeContractGroup === "storyboard" ||
      value.knowledgeContractGroup === "novel"
        ? { knowledgeContractGroup: value.knowledgeContractGroup }
        : {}),
      ...(knowledgeIds(value.referenceItemIds) !== undefined
        ? { referenceItemIds: knowledgeIds(value.referenceItemIds)?.slice(0, 3) }
        : {}),
      ...(knowledgeIds(value.selectedAssetIds) !== undefined
        ? { selectedAssetIds: knowledgeIds(value.selectedAssetIds)?.slice(0, MAX_SELECTED_ASSET_IDS) }
        : {}),
      ...(typeof value.allowAdult === "boolean" ? { allowAdult: value.allowAdult } : {}),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  save(state: PromptOrchestratorWorkspaceState): PromptOrchestratorWorkspaceState {
    const layerText = state.systemLayerText !== undefined
      ? persistedLayerText(state.systemLayerText)
      : undefined;
    const base = {
      prefabTerms: state.prefabTerms,
      modelId: state.modelId,
      loraIds: state.loraIds,
      ...(layerText !== undefined ? { systemLayerText: layerText } : {}),
      ...(state.systemLayerSource !== undefined
        ? { systemLayerSource: state.systemLayerSource }
        : {}),
      ...(state.writingPresetId !== undefined ? { writingPresetId: state.writingPresetId } : {}),
      ...(state.writingPresetVariant !== undefined
        ? { writingPresetVariant: state.writingPresetVariant }
        : {}),
      ...(state.writingPresetSectionIds !== undefined
        ? { writingPresetSectionIds: state.writingPresetSectionIds.slice(0, MAX_SECTION_IDS) }
        : {}),
      ...(state.mossLayout !== undefined ? { mossLayout: state.mossLayout } : {}),
      ...(state.knowledgePackIds !== undefined
        ? { knowledgePackIds: state.knowledgePackIds.slice(0, MAX_SECTION_IDS) }
        : {}),
      ...(state.knowledgeModuleIds !== undefined
        ? { knowledgeModuleIds: state.knowledgeModuleIds.slice(0, MAX_SECTION_IDS) }
        : {}),
      ...(state.knowledgeContractGroup !== undefined
        ? { knowledgeContractGroup: state.knowledgeContractGroup }
        : {}),
      ...(state.referenceItemIds !== undefined
        ? { referenceItemIds: state.referenceItemIds.slice(0, 3) }
        : {}),
      ...(state.selectedAssetIds !== undefined
        ? { selectedAssetIds: state.selectedAssetIds.slice(0, MAX_SELECTED_ASSET_IDS) }
        : {}),
      ...(state.allowAdult !== undefined ? { allowAdult: state.allowAdult } : {}),
    };
    const json = JSON.stringify(base);
    if (json.length > MAX_STATE_CHARS) {
      throw new Error("Orchestrator workspace state exceeds its size limit");
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
    return { ...base, updatedAt: new Date(updatedAt).toISOString() };
  }
}