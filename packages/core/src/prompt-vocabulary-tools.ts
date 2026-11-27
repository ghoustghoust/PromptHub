import type { PromptVocabDB } from "@prompthub/db";
import type {
  PromptOrchestrationInput,
  PromptRetrievalSearchTrace,
  PromptSelectedTerm,
  PromptTerm,
} from "@prompthub/shared/types";
import { normalizeEntityKey } from "@prompthub/shared/utils/prompt-entity-key";
import { resolvePromptTaskContract } from "@prompthub/shared/utils/prompt-task-contract";
import { entityCandidates } from "./prompt-entity-resolution";
import type { PromptLlmTool } from "./prompt-orchestrator-llm";
import {
  CATEGORY_SET,
  RETRIEVAL_CATEGORIES,
  VocabularyRetriever,
  candidatePayload,
  normalizeText,
  presentRetrieval,
  type RetrievalQuery,
} from "./prompt-vocabulary-retrieval";
import { estimatePromptTokens } from "./prompt-token-budget";
import {
  buildSearchTraceEntries,
  PromptRetrievalTraceCollector,
} from "./prompt-retrieval-trace";

const FORBIDDEN_SEARCH_CATEGORIES: ReadonlySet<string> = new Set([
  "artist",
  "character",
  "nsfw",
]);
const MAX_RESOLVE_TERMS = 8;
const MAX_SEARCH_QUERIES = 4;

export const RESOLVE_VOCABULARY_TOOL = "resolve_vocabulary";
export const SEARCH_VOCABULARY_TOOL = "search_vocabulary";

/** Two tools only: identity lookup and slot search. Everything else is policy. */
export function vocabularyToolDefinitions(): PromptLlmTool[] {
  return [
    {
      type: "function",
      function: {
        name: RESOLVE_VOCABULARY_TOOL,
        description:
          "Resolve named characters or artists the user wrote to stored vocabulary identities. Use exact names; an ambiguous name returns candidates instead of a guess. Never use this to invent a character from appearance.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            terms: {
              type: "array",
              minItems: 1,
              maxItems: MAX_RESOLVE_TERMS,
              items: { type: "string" },
              description: "Names exactly as written by the user.",
            },
            category: {
              type: "string",
              enum: ["character", "artist", "any"],
              description: "Optional identity category filter.",
            },
          },
          required: ["terms"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: SEARCH_VOCABULARY_TOOL,
        description:
          "Search descriptor vocabulary for one or more semantic slots. Returns a few ranked candidates per slot; no match is a valid result. Identity and NSFW categories are not searchable.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            queries: {
              type: "array",
              minItems: 1,
              maxItems: MAX_SEARCH_QUERIES,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  slotId: { type: "string", description: "Stable slot id you will cite in decisions." },
                  category: { type: "string", enum: [...RETRIEVAL_CATEGORIES] },
                  query: {
                    type: "string",
                    description:
                      "Short descriptive phrase from the user's request, e.g. 'warm tungsten light'. Never a category name or slot id.",
                  },
                  alternateQuery: { type: "string" },
                  purpose: { type: "string", enum: ["resolve", "compare", "inspire"] },
                  depth: { type: "string", enum: ["exact", "focused", "exploratory"] },
                  avoid: {
                    type: "array",
                    items: { type: "string" },
                    description: "Term ids or texts you do not want repeated.",
                  },
                },
                required: ["slotId", "category", "query"],
              },
            },
          },
          required: ["queries"],
        },
      },
    },
  ];
}

export interface VocabularyToolState {
  vocabulary: PromptVocabDB;
  retriever: VocabularyRetriever;
  budget: number;
  spent: number;
  visible: Map<string, PromptTerm>;
  seenIds: Set<string>;
  blockedConflicts: Map<string, string>;
  calls: number;
  queryCount: number;
  candidateCount: number;
  warnings: string[];
  round: number;
  trace: PromptRetrievalTraceCollector;
  /** Reverse runs read the picture; they must not widen vocabulary recall. */
  allowExploratory: boolean;
}

export function createVocabularyToolState(options: {
  input: PromptOrchestrationInput;
  vocabulary: PromptVocabDB;
  explicitTerms: PromptSelectedTerm[];
  trace?: PromptRetrievalTraceCollector;
}): VocabularyToolState {
  const blockedConflicts = new Map<string, string>();
  for (const term of options.explicitTerms) {
    if (term.selectionReason === "reference") continue;
    for (const conflictId of options.vocabulary.getConflicts(term.id)) {
      blockedConflicts.set(conflictId, term.id);
    }
  }
  return {
    vocabulary: options.vocabulary,
    retriever: new VocabularyRetriever(options.vocabulary, options.input),
    budget: options.input.vocabularyTokenBudget ?? 900,
    spent: 0,
    visible: new Map(),
    seenIds: new Set(),
    blockedConflicts,
    calls: 0,
    queryCount: 0,
    candidateCount: 0,
    warnings: [],
    round: 0,
    trace: options.trace ?? new PromptRetrievalTraceCollector(),
    allowExploratory: resolvePromptTaskContract(options.input).retrieval
      .allowExploratory,
  };
}

export interface VocabularyToolOutcome {
  /** JSON string sent back as the tool message. */
  content: string;
  /** Terms the model may cite in decisions. */
  terms: PromptTerm[];
}

function termCost(term: PromptTerm): number {
  return estimatePromptTokens(JSON.stringify(candidatePayload({
    term,
    score: 0,
    match: "lexical",
    relation: "related",
    tokens: new Set(),
  }))) + 8;
}

function readStringArray(value: unknown, label: string, max: number): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > max) {
    throw new Error(`${label} must contain 1 to ${max} strings`);
  }
  return value.map((entry, index) => {
    if (typeof entry !== "string" || !entry.trim() || entry.includes("\0")) {
      throw new Error(`${label}[${index}] must be a non-empty string`);
    }
    return entry.trim();
  });
}

function resolveTool(value: Record<string, unknown>, state: VocabularyToolState): VocabularyToolOutcome {
  const terms = readStringArray(value.terms, "terms", MAX_RESOLVE_TERMS);
  const category = value.category === "character" || value.category === "artist"
    ? value.category
    : "any";
  const results: Record<string, unknown>[] = [];
  const used: PromptTerm[] = [];
  for (const term of terms) {
    const key = normalizeEntityKey(term);
    const matches = key
      ? state.vocabulary.resolveTermAliases([key]).filter((match) =>
          match.category !== "nsfw" &&
          (category === "any" || match.category === category))
      : [];
    const candidates = entityCandidates(matches.map((match) => ({
      termId: match.termId,
      category: match.category,
      subcategory: match.subcategory,
      en: match.en,
      zh: match.zh,
      series: match.series,
      validationStatus: match.validationStatus,
    })));
    if (candidates.length === 0) {
      results.push({ term, status: "unresolved", candidates: [] });
      state.trace.addIdentity({
        round: state.round,
        origin: "model",
        term,
        status: "unresolved",
        candidates: [],
      });
      continue;
    }
    const cost = estimatePromptTokens(JSON.stringify(candidates)) + 8;
    if (state.budget <= 0 || state.spent + cost > state.budget) {
      results.push({ term, status: "budget_exceeded", candidates: [] });
      state.trace.addIdentity({
        round: state.round,
        origin: "model",
        term,
        status: "budget_exceeded",
        candidates: [],
      });
      state.warnings.push(`Identity lookup for "${term}" exceeded the vocabulary budget.`);
      continue;
    }
    state.spent += cost;
    for (const candidate of candidates) {
      for (const termId of candidate.termIds) {
        const row = state.vocabulary.getTerm(termId);
        if (!row) continue;
        state.visible.set(row.id, row);
        state.seenIds.add(row.id);
        used.push(row);
      }
    }
    const only = candidates.length === 1 ? candidates[0] : undefined;
    results.push({
      term,
      status: only ? "resolved" : "ambiguous",
      identity: only
        ? {
            displayName: only.displayName,
            category: only.category,
            series: only.series,
            zh: only.zh,
            termIds: only.termIds,
            hasAppearanceBundle: only.hasAppearanceBundle,
          }
        : null,
      candidates: candidates.map((candidate) => ({
        displayName: candidate.displayName,
        category: candidate.category,
        series: candidate.series,
        zh: candidate.zh,
      })),
    });
    state.trace.addIdentity({
      round: state.round,
      origin: "model",
      term,
      status: only ? "resolved" : "ambiguous",
      ...(only ? { displayName: only.displayName } : {}),
      candidates: candidates.map((candidate) => ({
        displayName: candidate.displayName,
        category: candidate.category,
        series: candidate.series,
        zh: candidate.zh,
      })),
    });
  }
  return {
    content: JSON.stringify({ results }),
    terms: used,
  };
}

function parseSearchQueries(value: unknown): RetrievalQuery[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_SEARCH_QUERIES) {
    throw new Error(`queries must contain 1 to ${MAX_SEARCH_QUERIES} items`);
  }
  return value.map((raw, index) => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new Error(`queries[${index}] must be an object`);
    }
    const query = raw as Record<string, unknown>;
    if (typeof query.slotId !== "string" || !query.slotId.trim()) {
      throw new Error(`queries[${index}].slotId must be a non-empty string`);
    }
    if (typeof query.category !== "string" || !query.category.trim()) {
      throw new Error(`queries[${index}].category must be a non-empty string`);
    }
    if (typeof query.query !== "string" || !query.query.trim()) {
      throw new Error(`queries[${index}].query must be a non-empty string`);
    }
    const purpose = query.purpose === "resolve" || query.purpose === "inspire"
      ? query.purpose
      : "compare";
    const depth = query.depth === "exact" || query.depth === "exploratory"
      ? query.depth
      : "focused";
    const avoid = Array.isArray(query.avoid)
      ? query.avoid.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : undefined;
    return {
      slotId: query.slotId.trim(),
      category: query.category.trim(),
      query: query.query.trim(),
      ...(typeof query.alternateQuery === "string" && query.alternateQuery.trim()
        ? { alternateQuery: query.alternateQuery.trim() }
        : {}),
      purpose,
      depth,
      ...(avoid && avoid.length > 0 ? { avoid } : {}),
    };
  });
}

function searchTool(value: Record<string, unknown>, state: VocabularyToolState): VocabularyToolOutcome {
  const queries = parseSearchQueries(value.queries);
  const groups: Record<string, unknown>[] = [];
  const used: PromptTerm[] = [];
  const acceptable: RetrievalQuery[] = [];
  for (const query of queries) {
    const effective =
      query.depth === "exploratory" && !state.allowExploratory
        ? { ...query, depth: "focused" as const }
        : query;
    if (effective !== query) {
      state.warnings.push(
        `Exploratory recall is not allowed for this task; slot ${query.slotId} was searched as focused.`,
      );
    }
    if (!CATEGORY_SET.has(effective.category) || FORBIDDEN_SEARCH_CATEGORIES.has(effective.category)) {
      groups.push({
        slotId: effective.slotId,
        status: "forbidden",
        candidates: [],
        reason: `Category ${effective.category} is not searchable; identities go through resolve_vocabulary.`,
      });
      const traced: PromptRetrievalSearchTrace = {
        round: state.round,
        origin: "model",
        slotId: effective.slotId,
        category: effective.category,
        query: effective.query,
        ...(effective.alternateQuery ? { alternateQuery: effective.alternateQuery } : {}),
        purpose: effective.purpose,
        depth: effective.depth,
        status: "forbidden",
        escalated: false,
        truncated: false,
        candidates: [],
      };
      state.trace.addSearches([traced]);
      state.warnings.push(
        `Search rejected forbidden category "${effective.category}" for slot ${effective.slotId}.`,
      );
      continue;
    }
    acceptable.push(effective);
  }
  state.queryCount += acceptable.length;
  if (acceptable.length === 0) {
    return { content: JSON.stringify({ groups }), terms: used };
  }
  const remaining = Math.max(0, state.budget - state.spent);
  const results = acceptable.map((query) => {
    const result = state.retriever.search(query);
    const avoid = query.avoid ?? [];
    const excludedByAvoid: Array<{ id: string; en: string }> = [];
    const duplicates: Array<{ id: string; en: string }> = [];
    const kept = result.candidates.filter((candidate) => {
      const term = candidate.term;
      const text = normalizeText(term.template?.trim() || term.en);
      // `avoid` accepts real ids or human text; both are matched literally.
      const avoided = avoid.some((entry) =>
        entry === term.id || normalizeText(entry) === text);
      if (avoided) {
        excludedByAvoid.push({ id: term.id, en: term.en });
        return false;
      }
      if (state.seenIds.has(term.id)) {
        duplicates.push({ id: term.id, en: term.en });
        return false;
      }
      return true;
    });
    return { ...result, candidates: kept, excludedByAvoid, duplicates };
  });
  const visible = presentRetrieval(results, remaining, state.blockedConflicts);
  const bySlot = new Map(results.map((result, index) => [acceptable[index].slotId, {
    excludedByAvoid: result.excludedByAvoid,
    duplicates: result.duplicates,
  }]));
  state.trace.addSearches(buildSearchTraceEntries({
    round: state.round,
    origin: "model",
    queries: acceptable,
    results,
    visible,
    extrasBySlot: bySlot,
  }));
  for (const group of visible.groups) {
    const record = group as Record<string, unknown>;
    const extra = bySlot.get(String(record.slotId));
    groups.push({
      ...record,
      ...(extra ? { excludedByAvoid: extra.excludedByAvoid, duplicates: extra.duplicates } : {}),
    });
  }
  for (const term of visible.terms.values()) {
    state.spent += termCost(term);
    state.visible.set(term.id, term);
    state.seenIds.add(term.id);
    used.push(term);
  }
  state.candidateCount += visible.candidateCount;
  return { content: JSON.stringify({ groups }), terms: used };
}

function toolError(
  state: VocabularyToolState,
  tool: string,
  error: string,
  message: string,
): VocabularyToolOutcome {
  state.trace.addError({ round: state.round, tool, error, message });
  return { content: JSON.stringify({ error, message }), terms: [] };
}

/**
 * Executes one model tool call. Argument or policy failures come back as a
 * tool result, not as an exception: the model can correct itself, while the
 * loop budget decides when the conversation must end.
 */
export function executeVocabularyTool(
  name: string,
  rawArguments: string,
  state: VocabularyToolState,
): VocabularyToolOutcome {
  let parsed: unknown;
  try {
    parsed = rawArguments.trim() ? JSON.parse(rawArguments) : {};
  } catch {
    return toolError(state, name, "invalid_arguments", "arguments must be valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return toolError(state, name, "invalid_arguments", "arguments must be an object");
  }
  const value = parsed as Record<string, unknown>;
  try {
    if (name === RESOLVE_VOCABULARY_TOOL) return resolveTool(value, state);
    if (name === SEARCH_VOCABULARY_TOOL) return searchTool(value, state);
    return toolError(state, name, "unknown_tool", `Unknown tool: ${name}`);
  } catch (error) {
    return toolError(
      state,
      name,
      "invalid_arguments",
      error instanceof Error ? error.message : String(error),
    );
  }
}