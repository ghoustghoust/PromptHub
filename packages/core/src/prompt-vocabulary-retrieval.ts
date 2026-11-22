import type {
  PromptOrchestrationInput,
  PromptOrchestrationMode,
  PromptTerm,
} from "@prompthub/shared/types";
import type { PromptVocabDB } from "@prompthub/db";
import { estimatePromptTokens } from "./prompt-token-budget";

/** Categories automatic semantic search may query. Identity categories stay out. */
export const RETRIEVAL_CATEGORIES = [
  "style",
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
export const CATEGORY_SET: ReadonlySet<string> = new Set(RETRIEVAL_CATEGORIES);

export const RAW_CANDIDATE_LIMIT = 60;
export const MAX_QUERIES_PER_CALL = 4;

export type RetrievalPurpose = "resolve" | "compare" | "inspire";
export type RetrievalDepth = "exact" | "focused" | "exploratory";
export type MatchKind = "exact" | "phrase" | "lexical";

/** How a candidate relates to the queried slot, independent of score. */
export type CandidateRelation =
  | "equivalent"
  | "narrower"
  | "broader"
  | "related"
  | "opposite";

export interface RelationPolicy {
  allowed: ReadonlySet<CandidateRelation>;
  /** Additive ranking weight; exactness still dominates through `matchBonus`. */
  bonus: Readonly<Record<CandidateRelation, number>>;
}

export interface RetrievalQuery {
  slotId: string;
  category: string;
  query: string;
  alternateQuery?: string;
  purpose: RetrievalPurpose;
  depth: RetrievalDepth;
  /** Term ids or normalized texts the model does not want repeated. */
  avoid?: string[];
}

export interface RankedTerm {
  term: PromptTerm;
  score: number;
  match: MatchKind;
  relation: CandidateRelation;
  tokens: Set<string>;
}

export interface RetrievalResult {
  slotId: string;
  candidates: RankedTerm[];
  collapsed: Array<{ id: string; en: string }>;
  /** Rows dropped by the task policy, kept for audit. */
  excludedRelations: Array<{ id: string; en: string; relation: CandidateRelation }>;
  escalated: boolean;
}

export interface VisibleRetrieval {
  groups: unknown[];
  terms: Map<string, PromptTerm>;
  candidateCount: number;
}

export interface RetrievalDocument {
  term: PromptTerm;
  texts: string[];
  normalizedTexts: string[];
  tokens: Map<string, number>;
  length: number;
}

/** Single-token or single-bigram queries are ambiguous; widen them deterministically. */
export function isShortQuery(query: string): boolean {
  return tokenize(query).length <= 1;
}

export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\\([()])/g, "$1")
    .replace(/[_/\\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(value: string): string[] {
  const segments = normalizeText(value).match(/[\u3400-\u9fff]+|[a-z0-9]+(?:\.[0-9]+)?/g) ?? [];
  const tokens: string[] = [];
  for (const segment of segments) {
    if (!/[\u3400-\u9fff]/.test(segment)) {
      tokens.push(segment);
      continue;
    }
    if (segment.length <= 2) {
      tokens.push(segment);
      continue;
    }
    for (let index = 0; index < segment.length - 1; index += 1) {
      tokens.push(segment.slice(index, index + 2));
    }
  }
  return tokens;
}

const NEGATION_WORDS = new Set([
  "no",
  "not",
  "without",
  "avoid",
  "exclude",
  "不要",
  "避免",
  "没有",
  "不使用",
]);

/** A deliberately small antonym table: lexical recall must not pretend to be semantics. */
const ANTONYM_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["soft", "hard"],
  ["light", "dark"],
  ["bright", "dim"],
  ["warm", "cool"],
  ["warm", "cold"],
  ["day", "night"],
  ["dawn", "dusk"],
  ["front", "back"],
  ["left", "right"],
  ["top", "bottom"],
  ["above", "below"],
  ["near", "far"],
  ["big", "small"],
  ["large", "small"],
  ["long", "short"],
  ["wide", "narrow"],
  ["open", "closed"],
  ["young", "old"],
  ["new", "old"],
  ["sit", "stand"],
  ["indoor", "outdoor"],
  ["inside", "outside"],
  ["summer", "winter"],
  ["black", "white"],
  ["full", "empty"],
  ["亮", "暗"],
  ["暖", "冷"],
  ["白天", "夜晚"],
  ["前", "后"],
  ["左", "右"],
  ["上", "下"],
  ["远", "近"],
  ["大", "小"],
  ["长", "短"],
  ["宽", "窄"],
  ["开", "关"],
  ["年轻", "年老"],
  ["新", "旧"],
  ["内", "外"],
  ["夏", "冬"],
  ["黑", "白"],
  ["满", "空"],
];

function isSubset(left: Set<string>, right: Set<string>): boolean {
  for (const token of left) {
    if (!right.has(token)) return false;
  }
  return true;
}

function hasAntonym(left: Set<string>, right: Set<string>): boolean {
  return ANTONYM_PAIRS.some(
    ([first, second]) =>
      (left.has(first) && right.has(second)) ||
      (left.has(second) && right.has(first)),
  );
}

function negationMismatch(left: Set<string>, right: Set<string>): boolean {
  let leftNegated = false;
  let rightNegated = false;
  for (const token of left) if (NEGATION_WORDS.has(token)) leftNegated = true;
  for (const token of right) if (NEGATION_WORDS.has(token)) rightNegated = true;
  return leftNegated !== rightNegated;
}

function relationRank(relation: CandidateRelation): number {
  if (relation === "equivalent") return 4;
  if (relation === "narrower") return 3;
  if (relation === "broader") return 2;
  if (relation === "related") return 1;
  return 0;
}

/**
 * Compares one query with one candidate. Token-set relations keep this
 * explainable: equal sets are equivalent, a strict superset is more specific
 * (narrower), a strict subset is more general (broader), overlap without
 * containment is merely related, and negation/antonym mismatch is opposite.
 */
export function classifyRelation(query: string, texts: string[]): CandidateRelation {
  const normalizedQuery = normalizeText(query);
  const queryTokens = new Set(tokenize(normalizedQuery));
  if (!normalizedQuery || queryTokens.size === 0) return "related";
  let best: CandidateRelation = "related";
  let bestRank = -1;
  let sawOpposite = false;
  for (const text of texts) {
    const normalizedText = normalizeText(text);
    if (!normalizedText) continue;
    const textTokens = new Set(tokenize(normalizedText));
    if (textTokens.size === 0) continue;
    let relation: CandidateRelation;
    if (normalizedText === normalizedQuery || isSubset(queryTokens, textTokens) && isSubset(textTokens, queryTokens)) {
      relation = "equivalent";
    } else if (negationMismatch(queryTokens, textTokens) || hasAntonym(queryTokens, textTokens)) {
      relation = "opposite";
    } else if (isSubset(queryTokens, textTokens)) {
      relation = "narrower";
    } else if (isSubset(textTokens, queryTokens)) {
      relation = "broader";
    } else {
      relation = "related";
    }
    if (relation === "opposite") {
      sawOpposite = true;
      continue;
    }
    const rank = relationRank(relation);
    if (rank > bestRank) {
      best = relation;
      bestRank = rank;
    }
  }
  // Opposite only wins when nothing positive described the candidate.
  if (bestRank < 0 && sawOpposite) return "opposite";
  return best;
}

const ALL_RELATIONS: ReadonlySet<CandidateRelation> = new Set([
  "equivalent",
  "narrower",
  "broader",
  "related",
  "opposite",
]);

/**
 * Task policy. Reverse accepts equivalent rows only; expansion prefers more
 * specific rows because it is supposed to add detail; polish keeps equivalence
 * first but still tolerates related material.
 */
export function relationPolicyFor(
  mode: PromptOrchestrationMode | undefined,
): RelationPolicy {
  const selected = mode ?? "expand";
  if (selected === "reverse") {
    return {
      allowed: new Set<CandidateRelation>(["equivalent"]),
      bonus: { equivalent: 40, narrower: 0, broader: 0, related: 0, opposite: 0 },
    };
  }
  if (selected === "polish") {
    return {
      allowed: new Set<CandidateRelation>(["equivalent", "narrower", "broader", "related"]),
      bonus: { equivalent: 36, narrower: 6, broader: -8, related: 0, opposite: 0 },
    };
  }
  if (selected === "expand" || selected === "professional") {
    return {
      allowed: new Set<CandidateRelation>(["equivalent", "narrower", "broader", "related"]),
      bonus: { equivalent: 30, narrower: 12, broader: -6, related: 2, opposite: 0 },
    };
  }
  return {
    allowed: ALL_RELATIONS,
    bonus: { equivalent: 0, narrower: 0, broader: 0, related: 0, opposite: 0 },
  };
}

function documentTexts(term: PromptTerm): string[] {
  return [...new Set([term.en, term.zh, term.template]
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    .map((value) => value.trim()))];
}

export function buildDocuments(terms: PromptTerm[]): RetrievalDocument[] {
  return terms.filter((term) => term.validationStatus !== "deprecated").map((term) => {
    const texts = documentTexts(term);
    const tokens = new Map<string, number>();
    for (const token of tokenize(texts.join(" "))) {
      tokens.set(token, (tokens.get(token) ?? 0) + 1);
    }
    const length = [...tokens.values()].reduce((total, count) => total + count, 0);
    return {
      term,
      texts,
      normalizedTexts: texts.map(normalizeText),
      tokens,
      length,
    };
  }).filter((document) => document.length > 0);
}

function documentFrequency(
  documents: RetrievalDocument[],
  queryTokens: Set<string>,
): Map<string, number> {
  const frequencies = new Map<string, number>();
  for (const token of queryTokens) {
    let count = 0;
    for (const document of documents) {
      if (document.tokens.has(token)) count += 1;
    }
    frequencies.set(token, count);
  }
  return frequencies;
}

function lexicalScore(
  document: RetrievalDocument,
  queryTokens: Set<string>,
  frequencies: Map<string, number>,
  documentCount: number,
  averageLength: number,
): { score: number; coverage: number } {
  let score = 0;
  let matched = 0;
  for (const token of queryTokens) {
    const frequency = document.tokens.get(token) ?? 0;
    if (frequency === 0) continue;
    matched += 1;
    const df = frequencies.get(token) ?? 0;
    const inverseFrequency = Math.log(1 + (documentCount - df + 0.5) / (df + 0.5));
    const normalization = frequency + 1.2 * (1 - 0.75 + 0.75 * document.length / averageLength);
    score += inverseFrequency * frequency * 2.2 / normalization;
  }
  return {
    score,
    coverage: queryTokens.size > 0 ? matched / queryTokens.size : 0,
  };
}

function matchKind(document: RetrievalDocument, query: string): MatchKind {
  if (document.normalizedTexts.some((text) => text === query)) return "exact";
  if (query.length >= 2 && document.normalizedTexts.some((text) =>
    text.length >= 2 && (text.includes(query) || query.includes(text)))) {
    return "phrase";
  }
  return "lexical";
}

export function rankDocuments(
  documents: RetrievalDocument[],
  queries: string[],
  policy: RelationPolicy,
): RankedTerm[] {
  const variants = [...new Set(queries.map(normalizeText).filter(Boolean))];
  const tokenVariants = variants.map((query) => new Set(tokenize(query)));
  const averageLength = documents.reduce((total, document) => total + document.length, 0)
    / Math.max(1, documents.length);
  const frequencies = tokenVariants.map((tokens) =>
    documentFrequency(documents, tokens));
  const ranked = documents.map((document) => {
    let best = {
      score: 0,
      match: "lexical" as MatchKind,
      relation: "related" as CandidateRelation,
    };
    variants.forEach((variant, index) => {
      const lexical = lexicalScore(
        document,
        tokenVariants[index],
        frequencies[index],
        documents.length,
        averageLength,
      );
      const match = matchKind(document, variant);
      const relation = classifyRelation(variant, document.texts);
      const bonus = match === "exact" ? 40 : match === "phrase" ? 6 : 0;
      const score = lexical.score + lexical.coverage * 4 + bonus + policy.bonus[relation];
      if (
        score > best.score ||
        (score === best.score && relationRank(relation) > relationRank(best.relation))
      ) {
        best = { score, match, relation };
      }
    });
    return {
      term: document.term,
      score: best.score,
      match: best.match,
      relation: best.relation,
      tokens: new Set(document.tokens.keys()),
    };
  });
  return ranked.filter((item) => item.score > 0).sort((left, right) =>
    right.score - left.score ||
    relationRank(right.relation) - relationRank(left.relation) ||
    left.term.en.localeCompare(right.term.en));
}

function jaccard(left: Set<string>, right: Set<string>): number {
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }
  const union = new Set([...left, ...right]).size;
  return union > 0 ? intersection / union : 0;
}

function candidateLimit(depth: RetrievalDepth): number {
  if (depth === "exact") return 3;
  if (depth === "exploratory") return 10;
  return 6;
}

export interface DiverseSelection {
  candidates: RankedTerm[];
  /** Near-identical expressions absorbed into the top-ranked row, for audit. */
  collapsed: Array<{ id: string; en: string }>;
}

export function selectDiverse(ranked: RankedTerm[], query: RetrievalQuery): DiverseSelection {
  const selected: RankedTerm[] = [];
  const collapsed: Array<{ id: string; en: string }> = [];
  const seenText = new Set<string>();
  const threshold = query.purpose === "inspire" ? 0.76 : query.purpose === "compare" ? 0.88 : 0.95;
  for (const candidate of ranked.slice(0, RAW_CANDIDATE_LIMIT)) {
    const textKey = normalizeText(candidate.term.template?.trim() || candidate.term.en);
    if (seenText.has(textKey)) {
      if (collapsed.length < 8) {
        collapsed.push({ id: candidate.term.id, en: candidate.term.en });
      }
      continue;
    }
    const tooSimilar = selected.some((existing) =>
      jaccard(existing.tokens, candidate.tokens) >= threshold,
    );
    if (tooSimilar) continue;
    selected.push(candidate);
    seenText.add(textKey);
    if (selected.length >= candidateLimit(query.depth)) break;
  }
  return { candidates: selected, collapsed };
}

/** Lexical retriever shared by every mode; no per-mode scoring forks. */
export class VocabularyRetriever {
  private readonly cache = new Map<string, PromptTerm[]>();

  constructor(
    private readonly vocabulary: PromptVocabDB,
    private readonly input: PromptOrchestrationInput,
  ) {}

  private terms(category: string): PromptTerm[] {
    const cached = this.cache.get(category);
    if (cached) return cached;
    const terms = this.vocabulary.listTermsByCategory(
      category,
      this.input.modelId,
      this.input.series,
      this.input.domain,
    ).filter((term) =>
      this.input.validatedOnly !== true || term.validationStatus === "validated");
    this.cache.set(category, terms);
    return terms;
  }

  search(query: RetrievalQuery): RetrievalResult {
    if (!CATEGORY_SET.has(query.category)) {
      return {
        slotId: query.slotId,
        candidates: [],
        collapsed: [],
        excludedRelations: [],
        escalated: false,
      };
    }
    const queries = [query.query, ...(query.alternateQuery ? [query.alternateQuery] : [])];
    const policy = relationPolicyFor(this.input.mode);
    const ranked = rankDocuments(buildDocuments(this.terms(query.category)), queries, policy);
    const allowed = ranked.filter((candidate) => policy.allowed.has(candidate.relation));
    const excludedRelations = ranked
      .filter((candidate) => !policy.allowed.has(candidate.relation))
      .slice(0, 8)
      .map((candidate) => ({
        id: candidate.term.id,
        en: candidate.term.en,
        relation: candidate.relation,
      }));
    // A single token (or a two-CJK-character label) matches too many unrelated
    // rows to stay useful at focused depth; widen it deterministically instead
    // of trusting the model to pick the right depth for it.
    const escalated = isShortQuery(query.query);
    const effective: RetrievalQuery = escalated ? { ...query, depth: "exploratory" } : query;
    const { candidates, collapsed } = selectDiverse(allowed, effective);
    return { slotId: query.slotId, candidates, collapsed, excludedRelations, escalated };
  }
}

export function candidatePayload(candidate: RankedTerm): Record<string, unknown> {
  const { term } = candidate;
  return {
    id: term.id,
    category: term.category,
    subcategory: term.subcategory,
    en: term.en,
    zh: term.zh,
    template: term.template,
    domain: term.domain,
    validationStatus: term.validationStatus,
    match: candidate.match,
    relation: candidate.relation,
  };
}

export function candidateCost(candidate: RankedTerm): number {
  return estimatePromptTokens(JSON.stringify(candidatePayload(candidate))) + 8;
}

export interface ConflictedCandidate {
  id: string;
  en: string;
  conflictsWith: string;
}

export function presentRetrieval(
  results: RetrievalResult[],
  budget: number,
  blockedConflicts: Map<string, string>,
): VisibleRetrieval {
  const groups: unknown[] = [];
  const terms = new Map<string, PromptTerm>();
  let candidateCount = 0;
  const slotBudget = results.length > 0 ? Math.floor(budget / results.length) : 0;
  for (const result of results) {
    const candidates: Record<string, unknown>[] = [];
    const excludedConflicts: ConflictedCandidate[] = [];
    let used = 0;
    for (const candidate of result.candidates) {
      const conflictsWith = blockedConflicts.get(candidate.term.id);
      if (conflictsWith) {
        if (excludedConflicts.length < 8) {
          excludedConflicts.push({
            id: candidate.term.id,
            en: candidate.term.en,
            conflictsWith,
          });
        }
        continue;
      }
      const cost = candidateCost(candidate);
      if (budget <= 0 || used + cost > slotBudget) continue;
      used += cost;
      candidates.push(candidatePayload(candidate));
      terms.set(candidate.term.id, candidate.term);
      candidateCount += 1;
    }
    groups.push({
      slotId: result.slotId,
      status: candidates.length > 0
        ? "match"
        : result.candidates.length > 0
          ? "budget_exceeded"
          : "no_match",
      truncated: candidates.length < result.candidates.length,
      escalated: result.escalated,
      collapsedTerms: result.collapsed,
      excludedRelations: result.excludedRelations,
      excludedConflicts,
      candidates,
    });
  }
  return { groups, terms, candidateCount };
}

export function mergeResults(current: RetrievalResult[], next: RetrievalResult[]): RetrievalResult[] {
  const merged = new Map(current.map((result) => [result.slotId, result]));
  for (const result of next) merged.set(result.slotId, result);
  return [...merged.values()];
}