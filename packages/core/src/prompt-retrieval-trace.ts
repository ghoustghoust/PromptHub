import type {
  PromptIdentityLookupTrace,
  PromptRetrievalCandidateTrace,
  PromptRetrievalFallbackTrace,
  PromptRetrievalSearchTrace,
  PromptRetrievalToolErrorTrace,
  PromptRetrievalTrace,
} from "@prompthub/shared/types";
import type {
  RankedTerm,
  RetrievalQuery,
  RetrievalResult,
  VisibleRetrieval,
} from "./prompt-vocabulary-retrieval";

interface SearchTraceExtras {
  excludedByAvoid?: Array<{ id: string; en: string }>;
  duplicates?: Array<{ id: string; en: string }>;
}

interface BuildSearchTraceOptions {
  round: number;
  origin: "model" | "policy";
  queries: RetrievalQuery[];
  results: RetrievalResult[];
  visible: VisibleRetrieval;
  extrasBySlot?: ReadonlyMap<string, SearchTraceExtras>;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function presentedIds(value: unknown): Set<string> {
  const group = record(value);
  if (!group || !Array.isArray(group.candidates)) return new Set<string>();
  return new Set(group.candidates.flatMap((candidate) => {
    const item = record(candidate);
    return item && typeof item.id === "string" ? [item.id] : [];
  }));
}

function conflictReasons(value: unknown): Map<string, string> {
  const group = record(value);
  if (!group || !Array.isArray(group.excludedConflicts)) return new Map<string, string>();
  const reasons = new Map<string, string>();
  for (const entry of group.excludedConflicts) {
    const item = record(entry);
    if (!item || typeof item.id !== "string" || typeof item.conflictsWith !== "string") continue;
    reasons.set(item.id, `Conflicts with user-selected term ${item.conflictsWith}.`);
  }
  return reasons;
}

function groupStatus(value: unknown): PromptRetrievalSearchTrace["status"] {
  const status = record(value)?.status;
  return status === "match" || status === "budget_exceeded" || status === "forbidden"
    ? status
    : "no_match";
}

function fullCandidate(
  candidate: RankedTerm,
  status: PromptRetrievalCandidateTrace["status"],
  reason?: string,
): PromptRetrievalCandidateTrace {
  return {
    id: candidate.term.id,
    en: candidate.term.en,
    zh: candidate.term.zh,
    match: candidate.match,
    relation: candidate.relation,
    score: candidate.score,
    status,
    ...(reason ? { reason } : {}),
  };
}

/** Converts the same raw and presented results into an observable audit trail. */
export function buildSearchTraceEntries(
  options: BuildSearchTraceOptions,
): PromptRetrievalSearchTrace[] {
  const queryBySlot = new Map(options.queries.map((query) => [query.slotId, query]));
  return options.results.map((result) => {
    const query = queryBySlot.get(result.slotId);
    if (!query) throw new Error(`Missing retrieval query for traced slot ${result.slotId}`);
    const group = options.visible.groups.find((entry) => record(entry)?.slotId === result.slotId);
    const visibleIds = presentedIds(group);
    const conflicts = conflictReasons(group);
    const extras = options.extrasBySlot?.get(result.slotId);
    const candidates: PromptRetrievalCandidateTrace[] = result.candidates.map((candidate) => {
      if (visibleIds.has(candidate.term.id)) return fullCandidate(candidate, "presented");
      const conflict = conflicts.get(candidate.term.id);
      if (conflict) return fullCandidate(candidate, "conflict", conflict);
      return fullCandidate(candidate, "budget", "Not presented within the slot candidate budget.");
    });
    for (const excluded of result.excludedRelations) {
      candidates.push({
        id: excluded.id,
        en: excluded.en,
        relation: excluded.relation,
        status: "relation",
        reason: "Excluded by the current task relation policy.",
      });
    }
    for (const collapsed of result.collapsed) {
      candidates.push({
        id: collapsed.id,
        en: collapsed.en,
        status: "collapsed",
        reason: "Collapsed as a near-duplicate expression.",
      });
    }
    for (const avoided of extras?.excludedByAvoid ?? []) {
      candidates.push({
        id: avoided.id,
        en: avoided.en,
        status: "avoid",
        reason: "Excluded by the model-provided avoid list.",
      });
    }
    for (const duplicate of extras?.duplicates ?? []) {
      candidates.push({
        id: duplicate.id,
        en: duplicate.en,
        status: "duplicate",
        reason: "Already presented by an earlier retrieval call.",
      });
    }
    return {
      round: options.round,
      origin: options.origin,
      slotId: result.slotId,
      category: query.category,
      query: query.query,
      ...(query.alternateQuery ? { alternateQuery: query.alternateQuery } : {}),
      purpose: query.purpose,
      depth: query.depth,
      status: groupStatus(group),
      escalated: result.escalated,
      truncated: record(group)?.truncated === true,
      candidates,
    };
  });
}

/** Per-run collector shared by primary, follow-up and fallback paths. */
export class PromptRetrievalTraceCollector {
  private readonly trace: PromptRetrievalTrace = {
    searches: [],
    identities: [],
    errors: [],
    fallbacks: [],
  };

  addSearches(entries: PromptRetrievalSearchTrace[]): void {
    this.trace.searches.push(...entries);
  }

  addIdentity(entry: PromptIdentityLookupTrace): void {
    this.trace.identities.push(entry);
  }

  addError(entry: PromptRetrievalToolErrorTrace): void {
    this.trace.errors.push(entry);
  }

  addFallback(entry: PromptRetrievalFallbackTrace): void {
    this.trace.fallbacks.push(entry);
  }

  hasContent(): boolean {
    return this.trace.searches.length > 0 || this.trace.identities.length > 0 ||
      this.trace.errors.length > 0 || this.trace.fallbacks.length > 0;
  }

  snapshot(): PromptRetrievalTrace {
    return structuredClone(this.trace);
  }
}
