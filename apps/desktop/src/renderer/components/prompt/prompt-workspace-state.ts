import type { PromptTermValidationStatus } from "@prompthub/shared/types";
import type { PrefabTerm, PrefabTermState } from "./usePromptOrchestratorWorkbench";

const MAX_TERMS = 2000;
const STATES: ReadonlySet<string> = new Set([
  "locked",
  "recommended",
  "reference",
  "excluded",
]);
const VALIDATION: ReadonlySet<string> = new Set([
  "pending",
  "unvalidated",
  "validated",
  "deprecated",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, max = 4000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max || trimmed.includes("\0")) return null;
  return trimmed;
}

/**
 * Restores persisted picker rows. Corrupted or unsupported rows are skipped
 * instead of breaking the workbench; the next save rewrites a clean state.
 */
export function normalizeWorkspaceTerms(value: unknown): PrefabTerm[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const terms: PrefabTerm[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const id = text(raw.id, 500);
    const category = text(raw.category, 60);
    const en = text(raw.en, 2000);
    if (!id || !category || !en || seen.has(id)) continue;
    seen.add(id);
    terms.push({
      id,
      category,
      subcategory: typeof raw.subcategory === "string" ? raw.subcategory : null,
      en,
      zh: typeof raw.zh === "string" ? raw.zh : null,
      series: typeof raw.series === "string" ? raw.series : null,
      template: typeof raw.template === "string" ? raw.template : null,
      validationStatus: (
        typeof raw.validationStatus === "string" && VALIDATION.has(raw.validationStatus)
          ? raw.validationStatus
          : "unvalidated"
      ) as PromptTermValidationStatus,
      state: (
        typeof raw.state === "string" && STATES.has(raw.state)
          ? raw.state
          : "recommended"
      ) as PrefabTermState,
    });
    if (terms.length >= MAX_TERMS) break;
  }
  return terms;
}