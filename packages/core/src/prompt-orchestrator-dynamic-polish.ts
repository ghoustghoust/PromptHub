import { PromptVocabDB } from "@prompthub/db";
import type {
  PromptModelDirective,
  PromptEntityResolution,
  PromptOrchestrationInput,
  PromptRetrievalSummary,
  PromptRoutePlan,
  PromptSelectedTerm,
  PromptTermDecision,
} from "@prompthub/shared/types";
import {
  buildCompositionMessages,
  parsePromptComposition,
  type PromptComposition,
  type PromptCompositionMessages,
} from "./prompt-orchestrator-composition";
import type { PromptOrchestratorLlm } from "./prompt-orchestrator-llm";
import {
  RETRIEVAL_CATEGORIES,
  VocabularyRetriever,
  mergeResults,
  normalizeText,
  presentRetrieval,
  type RetrievalQuery,
  type RetrievalResult,
} from "./prompt-vocabulary-retrieval";
import {
  assertNoConflicts,
  availableTerms,
  optionalText,
  parseJsonObject,
  parseTermDecisions,
  requiredText,
} from "./prompt-term-decisions";

const MAX_INITIAL_QUERIES = 4;
const MAX_FOLLOW_UP_QUERIES = 2;

interface DynamicPolishOptions {
  input: PromptOrchestrationInput;
  vocabulary: PromptVocabDB;
  llm: PromptOrchestratorLlm;
  explicitTerms: PromptSelectedTerm[];
  modelDirectives: PromptModelDirective[];
  /** Identity lookups resolved before planning; the model never guesses these. */
  entities?: PromptEntityResolution[];
  /** Input classification that decides whether retrieval runs at all. */
  routePlan?: PromptRoutePlan;
}

export interface DynamicPolishResult {
  composition: PromptComposition;
  selectedTerms: PromptSelectedTerm[];
  termDecisions: PromptTermDecision[];
  retrievalSummary: PromptRetrievalSummary;
  warnings: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePurpose(value: unknown): RetrievalQuery["purpose"] {
  return value === "resolve" || value === "inspire" ? value : "compare";
}

function parseDepth(value: unknown): RetrievalQuery["depth"] {
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

const QUERY_CONTRACT = `
Each query must be {"slotId":"stable slot id","category":"allowed category","query":"semantic query","alternateQuery":"optional bilingual or alternate wording","purpose":"resolve | compare | inspire","depth":"exact | focused | exploratory"}.
Allowed categories: ${RETRIEVAL_CATEGORIES.join(", ")}.
Do not query artist, character or NSFW categories. Do not infer a named character or artist from appearance. Exact names and trigger words already supplied by the user must remain untouched. Short single-token queries are widened to exploratory depth automatically (the group carries escalated=true); collapsedTerms lists duplicate expressions merged into the top-ranked row, so reference only the surviving candidate ids. Candidates that conflict with a user-selected or locked term are removed before presentation and listed under excludedConflicts; do not try to reintroduce them.`;

function planMessages(options: DynamicPolishOptions): PromptCompositionMessages {
  const system = [
    "You plan conservative vocabulary retrieval for a prompt-polishing task.",
    "Return one JSON object with a queries array and nothing else.",
    "Use zero to four queries, only for semantic slots where vocabulary may improve accuracy or expression. Do not query every category. An empty queries array is correct when the source needs no vocabulary.",
    "Resolved entity names are fixed facts. An ambiguous entity lists candidates and must not be decided here. Return zero queries when the input only names identities or fixed parameters.",
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
    entities: (options.entities ?? []).map((entity) => ({
      text: entity.mention.text,
      status: entity.status,
      displayName: entity.displayName ?? null,
    })),
    retrievalPath: options.routePlan?.path ?? "lexical",
  });
  return { system, user };
}

function compositionMessages(
  options: DynamicPolishOptions,
  visible: ReturnType<typeof presentRetrieval>,
  allowFollowUp: boolean,
): PromptCompositionMessages {
  const base = buildCompositionMessages(
    options.input,
    options.explicitTerms,
    options.modelDirectives,
    options.entities ?? [],
  );
  const parsed: unknown = JSON.parse(base.user);
  if (!isRecord(parsed)) throw new Error("Base composition payload must be an object");
  parsed.retrieval = visible.groups;
  parsed.allowFollowUp = allowFollowUp;
  parsed.retrievalPath = options.routePlan?.path ?? "lexical";
  parsed.allowCreate = options.routePlan?.allowCreate ?? true;
  parsed.entities = (options.entities ?? []).map((entity) => ({
    text: entity.mention.text,
    status: entity.status,
    displayName: entity.displayName ?? null,
    candidates:
      entity.status === "ambiguous"
        ? entity.candidates.map((candidate) => ({
            displayName: candidate.displayName,
            category: candidate.category,
            series: candidate.series,
            zh: candidate.zh,
          }))
        : [],
  }));
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
- Resolved entity names are fixed facts; keep their spelling. Ambiguous entities must not be decided: keep the user's wording and do not merge candidate attributes. Unresolved names stay verbatim.
- When retrievalPath is entity-only, no vocabulary was supplied and none may be invented; organize only the fixed identities and parameters. When allowCreate is false for a slot, do not invent a new visual fact for it.
- Return initialPrompt, completePrompt, fields and termDecisions together, while also following the existing output contract. ${followUp}`;
  return {
    system: `${base.system}\n\n${dynamicContract}`,
    user: JSON.stringify(parsed),
  };
}

function followUpQueries(content: string): RetrievalQuery[] {
  const root = parseJsonObject(content, "Dynamic polish response");
  if (root.followUpQueries === undefined ||
      (Array.isArray(root.followUpQueries) && root.followUpQueries.length === 0)) {
    return [];
  }
  return parseQueryList(root.followUpQueries, MAX_FOLLOW_UP_QUERIES);
}

function noMatchWarnings(results: RetrievalResult[], budget: number): string[] {
  if (budget <= 0) {
    return ["Automatic vocabulary context budget is zero; dynamic candidates were disabled."];
  }
  return results.filter((result) => result.candidates.length === 0).map((result) =>
    `No vocabulary candidates matched dynamic polish slot: ${result.slotId}.`);
}

/** A resolved identity that vanished from the output breaks the identity anchor. */
function missingIdentityWarnings(
  entities: PromptEntityResolution[],
  completePrompt: string,
): string[] {
  const text = normalizeText(completePrompt);
  const warnings: string[] = [];
  for (const entity of entities) {
    if (entity.status !== "resolved") continue;
    const variants = [
      entity.displayName,
      entity.mention.text,
      entity.candidates[0]?.zh ?? null,
    ]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map(normalizeText);
    if (variants.some((variant) => text.includes(variant))) continue;
    warnings.push(
      `Resolved identity "${entity.displayName ?? entity.mention.text}" is missing from the polished prompt.`,
    );
  }
  return warnings;
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
  const retriever = new VocabularyRetriever(options.vocabulary, options.input);
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
  const entityOnly = options.routePlan?.path === "entity-only";
  const initialQueries: RetrievalQuery[] = [];
  if (!entityOnly) {
    const plan = await options.llm.complete({
      messages: planMessages(options),
      mode: "polish",
      maxTokens: 1600,
    });
    initialQueries.push(
      ...parseQueryList(parseJsonObject(plan, "Retrieval plan").queries, MAX_INITIAL_QUERIES),
    );
  }
  let results = budget > 0
    ? initialQueries.map((query) => retriever.search(query))
    : initialQueries.map((query) => ({
        slotId: query.slotId,
        candidates: [],
        collapsed: [],
        excludedRelations: [],
        escalated: false,
      }));
  let rounds = budget > 0 && initialQueries.length > 0 ? 1 : 0;
  let queryCount = rounds > 0 ? initialQueries.length : 0;
  let content = "";
  let visible = presentRetrieval(results, budget, blockedConflicts);

  for (let round = 1; round <= 2; round += 1) {
    const allowFollowUp = round === 1 && budget > 0 && !entityOnly;
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
  const available = availableTerms(
    options.explicitTerms,
    visible.terms,
    options.vocabulary,
  );
  const parsed = parseTermDecisions(content, available, "Dynamic polish");
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
    warnings: [
      ...noMatchWarnings(results, budget),
      ...parsed.warnings,
      ...missingIdentityWarnings(options.entities ?? [], composition.completePrompt),
    ],
  };
}