import { PromptVocabDB } from "@prompthub/db";
import type {
  PromptModelDirective,
  PromptOrchestrationInput,
  PromptRetrievalSummary,
  PromptSelectedTerm,
  PromptTerm,
  PromptTermDecision,
  PromptTermDecisionStrategy,
} from "@prompthub/shared/types";
import {
  buildCompositionMessages,
  parsePromptComposition,
  type PromptComposition,
  type PromptCompositionMessages,
} from "./prompt-orchestrator-composition";
import type { PromptOrchestratorLlm } from "./prompt-orchestrator-llm";
import { estimatePromptTokens } from "./prompt-token-budget";

const RETRIEVAL_CATEGORIES = [
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
const CATEGORY_SET: ReadonlySet<string> = new Set(RETRIEVAL_CATEGORIES);
const MAX_INITIAL_QUERIES = 4;
const MAX_FOLLOW_UP_QUERIES = 2;
const MAX_DECISIONS = 32;
const RAW_CANDIDATE_LIMIT = 60;

type RetrievalPurpose = "resolve" | "compare" | "inspire";
type RetrievalDepth = "exact" | "focused" | "exploratory";
type MatchKind = "exact" | "phrase" | "lexical";

interface RetrievalQuery {
  slotId: string;
  category: string;
  query: string;
  alternateQuery?: string;
  purpose: RetrievalPurpose;
  depth: RetrievalDepth;
}

interface RankedTerm {
  term: PromptTerm;
  score: number;
  match: MatchKind;
  tokens: Set<string>;
}

interface RetrievalResult {
  slotId: string;
  candidates: RankedTerm[];
  collapsed: Array<{ id: string; en: string }>;
  escalated: boolean;
}

/** Single-token or single-bigram queries are ambiguous; widen them deterministically. */
function isShortQuery(query: string): boolean {
  return tokenize(query).length <= 1;
}

interface VisibleRetrieval {
  groups: unknown[];
  terms: Map<string, PromptTerm>;
  candidateCount: number;
}

interface DynamicPolishOptions {
  input: PromptOrchestrationInput;
  vocabulary: PromptVocabDB;
  llm: PromptOrchestratorLlm;
  explicitTerms: PromptSelectedTerm[];
  modelDirectives: PromptModelDirective[];
}

export interface DynamicPolishResult {
  composition: PromptComposition;
  selectedTerms: PromptSelectedTerm[];
  termDecisions: PromptTermDecision[];
  retrievalSummary: PromptRetrievalSummary;
  warnings: string[];
}

interface ParsedDecisions {
  decisions: PromptTermDecision[];
  usedTerms: PromptSelectedTerm[];
  warnings: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(content: string): Record<string, unknown> {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const parsed: unknown = JSON.parse(fenced?.[1] ?? trimmed);
  if (!isRecord(parsed)) throw new Error("Dynamic polish response must be a JSON object");
  return parsed;
}

function requiredText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  const text = value.trim();
  if (text.length > maxLength || text.includes("\0")) {
    throw new Error(`${label} exceeds its length limit or contains a null byte`);
  }
  return text;
}

function optionalText(value: unknown, label: string, maxLength: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return requiredText(value, label, maxLength);
}

function parsePurpose(value: unknown): RetrievalPurpose {
  return value === "resolve" || value === "inspire" ? value : "compare";
}

function parseDepth(value: unknown): RetrievalDepth {
  return value === "exact" || value === "exploratory" ? value : "focused";
}

function parseQuery(value: unknown, index: number): RetrievalQuery {
  if (!isRecord(value)) throw new Error(`Retrieval query ${index} must be an object`);
  const category = requiredText(value.category, `queries[${index}].category`, 60);
  return {
    slotId: requiredText(value.slotId, `queries[${index}].slotId`, 60),
    category,
    query: requiredText(value.query, `queries[${index}].query`, 180),
    alternateQuery: optionalText(
      value.alternateQuery,
      `queries[${index}].alternateQuery`,
      180,
    ),
    purpose: parsePurpose(value.purpose),
    depth: parseDepth(value.depth),
  };
}

function parseQueryList(value: unknown, maxQueries: number): RetrievalQuery[] {
  if (!Array.isArray(value) || value.length > maxQueries) {
    throw new Error(`Retrieval queries must be an array of at most ${maxQueries} items`);
  }
  const queries = value.map(parseQuery);
  const slotIds = new Set<string>();
  for (const query of queries) {
    if (slotIds.has(query.slotId)) {
      throw new Error(`Retrieval slotId must be unique within a batch: ${query.slotId}`);
    }
    slotIds.add(query.slotId);
  }
  return queries;
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\\([()])/g, "$1")
    .replace(/[_/\\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string): string[] {
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

interface RetrievalDocument {
  term: PromptTerm;
  texts: string[];
  normalizedTexts: string[];
  tokens: Map<string, number>;
  length: number;
}

function documentTexts(term: PromptTerm): string[] {
  return [...new Set([term.en, term.zh, term.template]
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    .map((value) => value.trim()))];
}

function buildDocuments(terms: PromptTerm[]): RetrievalDocument[] {
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

function rankDocuments(documents: RetrievalDocument[], queries: string[]): RankedTerm[] {
  const variants = [...new Set(queries.map(normalizeText).filter(Boolean))];
  const tokenVariants = variants.map((query) => new Set(tokenize(query)));
  const averageLength = documents.reduce((total, document) => total + document.length, 0)
    / Math.max(1, documents.length);
  const frequencies = tokenVariants.map((tokens) =>
    documentFrequency(documents, tokens));
  const ranked = documents.map((document) => {
    let best = { score: 0, match: "lexical" as MatchKind };
    variants.forEach((variant, index) => {
      const lexical = lexicalScore(
        document,
        tokenVariants[index],
        frequencies[index],
        documents.length,
        averageLength,
      );
      const match = matchKind(document, variant);
      const bonus = match === "exact" ? 40 : match === "phrase" ? 6 : 0;
      const score = lexical.score + lexical.coverage * 4 + bonus;
      if (score > best.score) best = { score, match };
    });
    return {
      term: document.term,
      score: best.score,
      match: best.match,
      tokens: new Set(document.tokens.keys()),
    };
  });
  return ranked.filter((item) => item.score > 0).sort((left, right) =>
    right.score - left.score || left.term.en.localeCompare(right.term.en));
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

interface DiverseSelection {
  candidates: RankedTerm[];
  /** Near-identical expressions absorbed into the top-ranked row, for audit. */
  collapsed: Array<{ id: string; en: string }>;
}

function selectDiverse(ranked: RankedTerm[], query: RetrievalQuery): DiverseSelection {
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

class LexicalVocabularyRetriever {
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
      return { slotId: query.slotId, candidates: [], collapsed: [], escalated: false };
    }
    const queries = [query.query, ...(query.alternateQuery ? [query.alternateQuery] : [])];
    const ranked = rankDocuments(buildDocuments(this.terms(query.category)), queries);
    // A single token (or a two-CJK-character label) matches too many unrelated
    // rows to stay useful at focused depth; widen it deterministically instead
    // of trusting the model to pick the right depth for it.
    const escalated = isShortQuery(query.query);
    const effective: RetrievalQuery = escalated ? { ...query, depth: "exploratory" } : query;
    const { candidates, collapsed } = selectDiverse(ranked, effective);
    return { slotId: query.slotId, candidates, collapsed, escalated };
  }
}

function candidatePayload(candidate: RankedTerm): Record<string, unknown> {
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
  };
}

function candidateCost(candidate: RankedTerm): number {
  return estimatePromptTokens(JSON.stringify(candidatePayload(candidate))) + 8;
}

function presentRetrieval(
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
    const excludedConflicts: Array<{ id: string; en: string; conflictsWith: string }> = [];
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
      excludedConflicts,
      candidates,
    });
  }
  return { groups, terms, candidateCount };
}

function mergeResults(current: RetrievalResult[], followUp: RetrievalResult[]): RetrievalResult[] {
  const merged = new Map(current.map((result) => [result.slotId, result]));
  for (const result of followUp) merged.set(result.slotId, result);
  return [...merged.values()];
}

const QUERY_CONTRACT = `
Each query must be {"slotId":"stable slot id","category":"allowed category","query":"semantic query","alternateQuery":"optional bilingual or alternate wording","purpose":"resolve | compare | inspire","depth":"exact | focused | exploratory"}.
Allowed categories: ${RETRIEVAL_CATEGORIES.join(", ")}.
Do not query artist, character or NSFW categories. Do not infer a named character or artist from appearance. Exact names and trigger words already supplied by the user must remain untouched. Short single-token queries are widened to exploratory depth automatically (the group carries escalated=true); collapsedTerms lists duplicate expressions merged into the top-ranked row, so reference only the surviving candidate ids. Candidates that conflict with a user-selected or locked term are removed before presentation and listed under excludedConflicts; do not try to reintroduce them.`;

function planMessages(options: DynamicPolishOptions): PromptCompositionMessages {
  const system = [
    "You plan conservative vocabulary retrieval for a prompt-polishing task.",
    "Return one JSON object with a queries array and nothing else.",
    "Use zero to four queries, only for semantic slots where vocabulary may improve accuracy or expression. Do not query every category. An empty queries array is correct when the source needs no vocabulary.",
    "Preserve the original scope and all negations. Use exact for a precise expression, focused for a small comparison, and exploratory only for genuine creative exploration.",
    QUERY_CONTRACT,
  ].join("\n\n");
  const user = JSON.stringify({
    intent: options.input.prompt ?? "",
    fixedDetails: options.input.fixedDetails ?? [],
    constraints: options.input.constraints ?? [],
    series: options.input.series ?? null,
    domain: options.input.domain ?? null,
    explicitTerms: options.explicitTerms,
    modelDirectives: options.modelDirectives,
  });
  return { system, user };
}

function compositionMessages(
  options: DynamicPolishOptions,
  visible: VisibleRetrieval,
  allowFollowUp: boolean,
): PromptCompositionMessages {
  const base = buildCompositionMessages(
    options.input,
    options.explicitTerms,
    options.modelDirectives,
  );
  const parsed: unknown = JSON.parse(base.user);
  if (!isRecord(parsed)) throw new Error("Base composition payload must be an object");
  parsed.retrieval = visible.groups;
  parsed.allowFollowUp = allowFollowUp;
  const followUp = allowFollowUp
    ? `If the candidates are genuinely insufficient, you may instead return only {"followUpQueries":[...]} with at most two revised or additional queries. This is the only permitted follow-up round. Do not also return a composition in that case. ${QUERY_CONTRACT}`
    : "Do not request another retrieval round; produce the final composition and decisions now.";
  const dynamicContract = `
Dynamic polish knowledge contract:
- Candidates are community references, not automatically verified knowledge. validationStatus applies only to the supplied record and does not prove universal model compatibility.
- Preserve the source prompt's meaning. Use the vocabulary only when it improves the current slot; no minimum usage quota exists.
- Add a termDecisions array with one to 32 entries. Each entry must be {"slotId":"stable slot id","category":"semantic category","sourceText":"source semantic","strategy":"reuse | adapt | create | ignore","termIds":["supplied candidate ids"],"output":"result for this slot","rationale":"short reason"}.
- reuse: use a supplied term when it is semantically accurate and compatible. adapt: use supplied term IDs as anchors while adding necessary context or relationships. create: write an original expression with termIds=[] when no candidate is suitable. ignore: reject unsuitable or unnecessary vocabulary with output=""; rejected candidate IDs may remain in termIds for audit.
- Never invent candidate IDs. Do not infer named characters or artists. Do not turn a broader observation into a more specific visual fact. Do not add unrelated details merely to use vocabulary.
- Return initialPrompt, completePrompt, fields and termDecisions together, while also following the existing output contract. ${followUp}`;
  return {
    system: `${base.system}\n\n${dynamicContract}`,
    user: JSON.stringify(parsed),
  };
}

function selectedTerm(term: PromptTerm): PromptSelectedTerm {
  return {
    id: term.id,
    category: term.category,
    en: term.en,
    zh: term.zh,
    series: term.series,
    template: term.template,
    source: term.source,
    validationStatus: term.validationStatus,
    locked: false,
    selectionReason: "relevance",
  };
}

function parseTermIds(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 8) {
    throw new Error("Decision termIds must be an array of at most eight items");
  }
  return value.map((id, index) => requiredText(id, `termIds[${index}]`, 240));
}

function parseStrategy(value: unknown, index: number): PromptTermDecisionStrategy {
  const strategy = requiredText(value, `termDecisions[${index}].strategy`, 20);
  if (strategy === "reuse" || strategy === "adapt" ||
      strategy === "create" || strategy === "ignore") {
    return strategy;
  }
  throw new Error(`Unsupported term decision strategy: ${strategy}`);
}

function parseDecision(
  value: unknown,
  index: number,
  available: Map<string, PromptTerm>,
  warnings: string[],
): PromptTermDecision {
  if (!isRecord(value)) throw new Error(`termDecisions[${index}] must be an object`);
  const strategy = parseStrategy(value.strategy, index);
  const termIds = parseTermIds(value.termIds);
  const terms = termIds.flatMap((id) => {
    const term = available.get(id);
    if (!term) {
      warnings.push(`Decision ${index + 1} referenced an unavailable term id: ${id}.`);
      return [];
    }
    return [term];
  });
  let finalStrategy = strategy;
  if ((strategy === "reuse" || strategy === "adapt") && terms.length === 0) {
    finalStrategy = "create";
    warnings.push(`Decision ${index + 1} was changed to create because no valid term id remained.`);
  }
  const output = finalStrategy === "ignore"
    ? ""
    : requiredText(value.output, `termDecisions[${index}].output`, 8000);
  return {
    slotId: requiredText(value.slotId, `termDecisions[${index}].slotId`, 60),
    category: requiredText(value.category, `termDecisions[${index}].category`, 60),
    sourceText: requiredText(value.sourceText, `termDecisions[${index}].sourceText`, 2000),
    strategy: finalStrategy,
    terms: finalStrategy === "create" ? [] : terms.map((term) => ({
      id: term.id,
      category: term.category,
      en: term.en,
      zh: term.zh,
    })),
    output,
    rationale: optionalText(value.rationale, `termDecisions[${index}].rationale`, 2000) ?? "",
  };
}

function parseDecisions(
  content: string,
  available: Map<string, PromptTerm>,
): ParsedDecisions {
  const root = parseJson(content);
  if (!Array.isArray(root.termDecisions) ||
      root.termDecisions.length < 1 ||
      root.termDecisions.length > MAX_DECISIONS) {
    throw new Error(`Dynamic polish requires 1 to ${MAX_DECISIONS} termDecisions`);
  }
  const warnings: string[] = [];
  const decisions = root.termDecisions.map((value, index) =>
    parseDecision(value, index, available, warnings));
  const used = new Map<string, PromptSelectedTerm>();
  for (const decision of decisions) {
    if (decision.strategy !== "reuse" && decision.strategy !== "adapt") continue;
    for (const term of decision.terms) {
      const full = available.get(term.id);
      if (full) used.set(term.id, selectedTerm(full));
    }
  }
  return { decisions, usedTerms: [...used.values()], warnings };
}

function followUpQueries(content: string): RetrievalQuery[] {
  const root = parseJson(content);
  if (root.followUpQueries === undefined ||
      (Array.isArray(root.followUpQueries) && root.followUpQueries.length === 0)) {
    return [];
  }
  return parseQueryList(root.followUpQueries, MAX_FOLLOW_UP_QUERIES);
}

function availableTerms(
  explicitTerms: PromptSelectedTerm[],
  visible: VisibleRetrieval,
  vocabulary: PromptVocabDB,
): Map<string, PromptTerm> {
  const available = new Map(visible.terms);
  for (const selected of explicitTerms) {
    const term = vocabulary.getTerm(selected.id);
    if (term) available.set(term.id, term);
  }
  return available;
}

function noMatchWarnings(results: RetrievalResult[], budget: number): string[] {
  if (budget <= 0) {
    return ["Automatic vocabulary context budget is zero; dynamic candidates were disabled."];
  }
  return results.filter((result) => result.candidates.length === 0).map((result) =>
    `No vocabulary candidates matched dynamic polish slot: ${result.slotId}.`);
}

function assertNoConflicts(
  vocabulary: PromptVocabDB,
  explicitTerms: PromptSelectedTerm[],
  dynamicTerms: PromptSelectedTerm[],
): void {
  const accepted = explicitTerms.filter((term) => term.selectionReason !== "reference");
  for (const candidate of dynamicTerms) {
    const conflicts = new Set(vocabulary.getConflicts(candidate.id));
    const conflict = accepted.find((term) => conflicts.has(term.id));
    if (conflict) {
      throw new Error(
        `Dynamic polish selected conflicting vocabulary terms: ${candidate.id} and ${conflict.id}.`,
      );
    }
    accepted.push(candidate);
  }
}

export function isDynamicPolish(input: PromptOrchestrationInput): boolean {
  return (input.mode ?? "expand") === "polish" &&
    (input.guidanceMode ?? "agent-led") === "agent-led" &&
    input.outputFormat !== "layout";
}

export async function runDynamicPolish(
  options: DynamicPolishOptions,
): Promise<DynamicPolishResult> {
  const budget = options.input.vocabularyTokenBudget ?? 900;
  const retriever = new LexicalVocabularyRetriever(options.vocabulary, options.input);
  // Conflicts with anything the user already selected are filtered before the
  // model sees candidates; otherwise a plausible-looking conflicting row turns
  // one bad pick into a full polish fallback.
  const blockedConflicts = new Map<string, string>();
  for (const term of options.explicitTerms) {
    if (term.selectionReason === "reference") continue;
    for (const conflictId of options.vocabulary.getConflicts(term.id)) {
      blockedConflicts.set(conflictId, term.id);
    }
  }
  const plan = await options.llm.complete({
    messages: planMessages(options),
    mode: "polish",
    maxTokens: 1600,
  });
  const initialQueries = parseQueryList(parseJson(plan).queries, MAX_INITIAL_QUERIES);
  let results = budget > 0
    ? initialQueries.map((query) => retriever.search(query))
    : initialQueries.map((query) => ({
        slotId: query.slotId,
        candidates: [],
        collapsed: [],
        escalated: false,
      }));
  let rounds = budget > 0 && initialQueries.length > 0 ? 1 : 0;
  let queryCount = rounds > 0 ? initialQueries.length : 0;
  let content = "";
  let visible = presentRetrieval(results, budget, blockedConflicts);

  for (let round = 1; round <= 2; round += 1) {
    const allowFollowUp = round === 1 && budget > 0;
    content = await options.llm.complete({
      messages: compositionMessages(options, visible, allowFollowUp),
      mode: "polish",
    });
    const followUp = allowFollowUp ? followUpQueries(content) : [];
    if (followUp.length === 0) break;
    const next = followUp.map((query) => retriever.search(query));
    results = mergeResults(results, next);
    rounds += 1;
    queryCount += followUp.length;
    visible = presentRetrieval(results, budget, blockedConflicts);
  }

  const composition = parsePromptComposition(content, "polish", options.input.includePayload);
  const available = availableTerms(options.explicitTerms, visible, options.vocabulary);
  const parsed = parseDecisions(content, available);
  assertNoConflicts(options.vocabulary, options.explicitTerms, parsed.usedTerms);
  const selected = new Map(
    options.explicitTerms
      .filter((term) => term.selectionReason !== "reference")
      .map((term) => [term.id, term]),
  );
  for (const term of parsed.usedTerms) {
    if (!selected.has(term.id)) selected.set(term.id, term);
  }
  const retrievalSummary: PromptRetrievalSummary = {
    rounds,
    queryCount,
    candidateCount: visible.candidateCount,
  };
  return {
    composition,
    selectedTerms: [...selected.values()],
    termDecisions: parsed.decisions,
    retrievalSummary,
    warnings: [...noMatchWarnings(results, budget), ...parsed.warnings],
  };
}
