import type { PromptProvenanceEntry } from "@prompthub/shared/types";
import type { PrefabTerm, PrefabTermState } from "./usePromptOrchestratorWorkbench";

/** Maps a provenance outcome back to the picker's four user-facing states. */
export function backfillStateFor(entry: PromptProvenanceEntry | undefined): PrefabTermState {
  if (!entry) return "recommended";
  if (entry.state === "locked") return "locked";
  if (entry.state === "reference") return "reference";
  if (entry.state === "excluded") return "excluded";
  return "recommended";
}

/**
 * Whether a result row should return to the picker. Automatic rows the model
 * never used are not pinned; explicit user rows always come back, even when the
 * system failed to write them.
 */
export function shouldBackfillProvenance(entry: PromptProvenanceEntry): boolean {
  if (!entry.termId) return false;
  if (entry.state === "excluded") return true;
  if (entry.outcome !== "absent") return true;
  return entry.state === "locked" || entry.state === "recommended" || entry.state === "reference";
}

/**
 * Merges result terms into the current picker selection. User intent wins:
 * an existing locked or excluded row keeps its state, so a result can never
 * silently unlock or re-include a term the user fixed by hand.
 */
export function mergeBackfillTerms(
  current: PrefabTerm[],
  incoming: PrefabTerm[],
): PrefabTerm[] {
  const byId = new Map(current.map((term) => [term.id, term]));
  const order = current.map((term) => term.id);
  for (const term of incoming) {
    const existing = byId.get(term.id);
    if (!existing) {
      byId.set(term.id, term);
      order.push(term.id);
      continue;
    }
    if (existing.state === "locked" || existing.state === "excluded") continue;
    byId.set(term.id, { ...existing, state: term.state });
  }
  return order.flatMap((id) => {
    const term = byId.get(id);
    return term ? [term] : [];
  });
}