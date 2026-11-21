import { PromptVocabDB } from "@prompthub/db";
import type {
  PromptOrchestrationInput,
  PromptSelectedTerm,
  PromptTermSelectionReason,
} from "@prompthub/shared/types";
import type { PromptTerm } from "@prompthub/shared/types";
import { estimatePromptTokens } from "./prompt-token-budget";

export const DEFAULT_PROMPT_CATEGORIES = [
  "style",
  "artist",
  "base",
  "body",
  "face",
  "hair",
  "clothing",
  "accessory",
  "pose",
  "expression",
  "environment",
  "weather",
  "props",
  "lighting",
  "composition",
  "camera",
] as const;

const CATEGORY_ORDER = new Map<string, number>(
  DEFAULT_PROMPT_CATEGORIES.map((category, index) => [category, index]),
);

export interface PromptVocabularySelection {
  terms: PromptSelectedTerm[];
  warnings: string[];
}

function unique(values: string[] | undefined): string[] {
  return [...new Set(values ?? [])];
}

function termKey(term: PromptTerm): string {
  return `${term.category.toLowerCase()}\0${term.en.trim().toLowerCase()}`;
}

function appliesToModel(term: PromptTerm, modelId: string | undefined): boolean {
  return (
    modelId === undefined ||
    term.applicableModels.length === 0 ||
    term.applicableModels.includes(modelId)
  );
}

function appliesToSeries(term: PromptTerm, series: string | undefined): boolean {
  if (series === undefined) return true;
  const key = series.trim();
  // A category name may be used as a series group when the vocabulary has no
  // dedicated series metadata yet.
  return term.series === null || term.series === key || term.category === key;
}

function searchText(input: PromptOrchestrationInput): string {
  return [
    input.prompt,
    input.editInstruction,
    input.random?.subject,
    input.random?.setting,
    input.series,
    ...(input.fixedDetails ?? []),
    ...(input.constraints ?? []),
    input.video?.style,
    input.video?.action,
    input.video?.cameraMotion,
    input.video?.lighting,
    input.video?.referencePlan,
    input.video?.continuity,
  ]
    .filter((value): value is string => typeof value === "string")
    .join("\n")
    .toLowerCase();
}

function relevanceScore(term: PromptTerm, query: string): number {
  const en = term.en.trim().toLowerCase();
  const zh = term.zh?.trim().toLowerCase() ?? "";
  const template = term.template?.trim().toLowerCase() ?? "";
  let score = 0;
  if (en && query.includes(en)) score += 100 + en.length;
  if (zh && query.includes(zh)) score += 120 + zh.length;
  if (template && query.includes(template)) score += 100 + template.length;
  const queryWords = new Set(query.split(/[^a-z0-9_]+/).filter(Boolean));
  for (const word of `${en} ${template}`.split(/[^a-z0-9_]+/).filter(Boolean)) {
    if (word.length >= 3 && queryWords.has(word)) score += 8;
  }
  return score;
}

function seededRandom(seed: string): () => number {
  let state = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    state ^= seed.charCodeAt(index);
    state = Math.imul(state, 16777619);
  }
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(terms: PromptTerm[], seed: string): PromptTerm[] {
  const result = [...terms];
  const random = seededRandom(seed);
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

class TermCollector {
  readonly terms: PromptSelectedTerm[] = [];
  private readonly ids = new Set<string>();
  private readonly keys = new Set<string>();
  private automaticTokens = 0;
  private budgetWarningEmitted = false;

  constructor(
    private readonly db: PromptVocabDB,
    private readonly input: PromptOrchestrationInput,
    private readonly warnings: string[],
  ) {}

  add(
    term: PromptTerm,
    selectionReason: PromptTermSelectionReason,
    locked = false,
  ): boolean {
    if (!this.isAllowed(term, selectionReason !== "relevance" && selectionReason !== "random")) return false;
    const key = termKey(term);
    if (this.ids.has(term.id) || this.keys.has(key)) return false;
    const automaticCost = estimatePromptTokens(term.template?.trim() || term.en) + 8;
    if (selectionReason === "relevance" || selectionReason === "random") {
      const budget = this.input.vocabularyTokenBudget ?? 900;
      if (this.automaticTokens + automaticCost > budget) {
        if (!this.budgetWarningEmitted) {
          this.warnings.push(
            `Automatic vocabulary reached the estimated ${budget}-token context budget; explicit user selections were retained.`,
          );
          this.budgetWarningEmitted = true;
        }
        return false;
      }
    }
    const conflict = this.db
      .getConflicts(term.id)
      .find((id) => this.ids.has(id));
    if (conflict) {
      this.warnings.push(
        `Term ${term.id} was excluded because it conflicts with ${conflict}.`,
      );
      return false;
    }
    this.ids.add(term.id);
    this.keys.add(key);
    if (selectionReason === "relevance" || selectionReason === "random") {
      this.automaticTokens += automaticCost;
    }
    this.terms.push({
      id: term.id,
      category: term.category,
      en: term.en,
      zh: term.zh,
      series: term.series,
      template: term.template,
      source: term.source,
      validationStatus: term.validationStatus,
      locked,
      selectionReason,
    });
    return true;
  }

  private isAllowed(term: PromptTerm, explicit: boolean): boolean {
    const excluded = unique(this.input.excludedTermIds).includes(term.id);
    const invalid =
      excluded ||
      term.validationStatus === "deprecated" ||
      (this.input.validatedOnly === true &&
        term.validationStatus !== "validated") ||
      !appliesToModel(term, this.input.modelId) ||
      !appliesToSeries(term, this.input.series);
    if (invalid && explicit) {
      this.warnings.push(
        `Explicit term ${term.id} was excluded by the active model, series, validation, or exclusion policy.`,
      );
    }
    return !invalid;
  }
}

function addExplicitTerms(
  db: PromptVocabDB,
  input: PromptOrchestrationInput,
  collector: TermCollector,
  warnings: string[],
): void {
  const locked = new Set(unique(input.lockedTermIds));
  const recommended = new Set(unique(input.selectedTermIds));
  const reference = new Set(unique(input.referenceTermIds));
  const excluded = new Set(unique(input.excludedTermIds));
  const ids = unique([...locked, ...recommended, ...reference]);
  for (const id of ids) {
    if (excluded.has(id)) {
      warnings.push(`Explicit term ${id} was ignored because the user excluded it.`);
      continue;
    }
    const term = db.getTerm(id);
    if (!term) {
      warnings.push(`Explicit term was not found: ${id}.`);
      continue;
    }
    const reason = locked.has(id) || recommended.has(id) ? "explicit" : "reference";
    collector.add(term, reason, locked.has(id));
  }
}

function orderedCandidates(
  terms: PromptTerm[],
  input: PromptOrchestrationInput,
  query: string,
): PromptTerm[] {
  if (input.mode === "random") {
    const seed = String(input.random?.seed ?? `${Date.now()}-${Math.random()}`);
    return shuffled(terms, seed);
  }
  return terms
    .map((term) => ({ term, score: relevanceScore(term, query) }))
    .filter(({ score }) => input.mode === "professional" || score > 0)
    .sort(
      (left, right) =>
        right.score - left.score || left.term.en.localeCompare(right.term.en),
    )
    .map(({ term }) => term);
}

function addCategoryTerms(
  db: PromptVocabDB,
  input: PromptOrchestrationInput,
  collector: TermCollector,
): void {
  const categories = unique(input.categories ?? [...DEFAULT_PROMPT_CATEGORIES]);
  const limit =
    input.candidateLimitPerCategory ??
    (input.guidanceMode === "human-led" ? 0 : 2);
  const query = searchText(input);
  for (const category of categories) {
    const terms = db.listTermsByCategory(
      category,
      input.modelId,
      input.series?.trim(),
    );
    const candidates = orderedCandidates(terms, input, query);
    let added = 0;
    for (const term of candidates) {
      if (added >= limit) break;
      const reason = input.mode === "random" ? "random" : "relevance";
      if (collector.add(term, reason)) added += 1;
    }
  }
}

function compareTerms(
  left: PromptSelectedTerm,
  right: PromptSelectedTerm,
): number {
  const leftOrder = CATEGORY_ORDER.get(left.category) ?? 1000;
  const rightOrder = CATEGORY_ORDER.get(right.category) ?? 1000;
  return (
    leftOrder - rightOrder ||
    left.category.localeCompare(right.category) ||
    left.en.localeCompare(right.en)
  );
}

export function selectPromptTerms(
  db: PromptVocabDB,
  input: PromptOrchestrationInput,
): PromptVocabularySelection {
  const warnings: string[] = [];
  const collector = new TermCollector(db, input, warnings);
  addExplicitTerms(db, input, collector, warnings);
  addCategoryTerms(db, input, collector);
  const terms = collector.terms.sort(compareTerms);
  if (terms.length === 0) {
    warnings.push("No compatible vocabulary terms were selected.");
  }
  return { terms, warnings: unique(warnings) };
}
