import type { PromptVocabDB } from "@prompthub/db";
import type {
  PromptEntityResolution,
  PromptModelDirective,
  PromptOrchestrationInput,
  PromptRetrievalSummary,
  PromptRetrievalTrace,
  PromptRoutePlan,
  PromptSelectedTerm,
} from "@prompthub/shared/types";
import {
  buildCompositionMessages,
  parsePromptComposition,
  type PromptComposition,
} from "./prompt-orchestrator-composition";
import type {
  PromptLlmMessage,
  PromptOrchestratorLlm,
} from "./prompt-orchestrator-llm";
import {
  RESOLVE_VOCABULARY_TOOL,
  SEARCH_VOCABULARY_TOOL,
  createVocabularyToolState,
  executeVocabularyTool,
  vocabularyToolDefinitions,
  type VocabularyToolState,
} from "./prompt-vocabulary-tools";
import {
  assertNoConflicts,
  availableTerms,
  parseTermDecisions,
} from "./prompt-term-decisions";
import type { PromptTermDecision } from "@prompthub/shared/types";
import { resolvePromptTaskContract } from "@prompthub/shared/utils/prompt-task-contract";
import {
  createStreamCallbacks,
  type PromptStreamEmitter,
} from "./prompt-orchestrator-stream";
import type { PromptRetrievalTraceCollector } from "./prompt-retrieval-trace";
import { estimatePromptTokens } from "./prompt-token-budget";

const MAX_TOOL_ROUNDS = 4;
const MAX_TOOL_CALLS = 6;

/**
 * Output tokens the remaining context can still hold. A 4096-token answer on
 * top of a long tool conversation overruns an 8K window and is cut off, which
 * then looks like a provider failure; this keeps the answer inside the window.
 */
export function outputBudget(
  messages: PromptLlmMessage[],
  contextTokens: number,
  requested: number,
): number {
  const used = estimatePromptTokens(
    messages.map((message) => `${message.role}: ${message.content ?? ""}`).join("\n"),
  );
  const remaining = contextTokens - used - 256;
  return Math.max(512, Math.min(requested, remaining));
}

export interface ToolRetrievalOptions {
  input: PromptOrchestrationInput;
  vocabulary: PromptVocabDB;
  llm: PromptOrchestratorLlm;
  explicitTerms: PromptSelectedTerm[];
  modelDirectives: PromptModelDirective[];
  entities?: PromptEntityResolution[];
  routePlan?: PromptRoutePlan;
  /** Observational stream side-channel; no effect on the returned result. */
  onEvent?: PromptStreamEmitter;
  /** Cancels before the next model round; the in-flight request aborts itself. */
  signal?: AbortSignal;
  /** Shared with the outer orchestrator so failures keep their partial trace. */
  trace?: PromptRetrievalTraceCollector;
}

export interface ToolRetrievalResult {
  composition: PromptComposition;
  selectedTerms: PromptSelectedTerm[];
  termDecisions: PromptTermDecision[];
  retrievalSummary: PromptRetrievalSummary;
  retrievalTrace: PromptRetrievalTrace;
  warnings: string[];
}

/** The task contract decides; the four text modes share one tool layer. */
export function supportsToolRetrieval(
  input: PromptOrchestrationInput,
  llm: PromptOrchestratorLlm,
): boolean {
  if (typeof llm.completeWithTools !== "function") return false;
  const contract = resolvePromptTaskContract(input);
  return contract.retrieval.modelTools;
}

function toolContract(routePlan: PromptRoutePlan | undefined): string {
  const path = routePlan?.path ?? "lexical";
  return `
Tool-assisted knowledge contract:
- You have exactly two tools: ${RESOLVE_VOCABULARY_TOOL} for named identities and ${SEARCH_VOCABULARY_TOOL} for descriptor slots. Before composing, check each descriptor slot the user supplied (lighting, camera or lens, clothing, pose, style, environment, props). If any of them could use library wording, call ${SEARCH_VOCABULARY_TOOL} once with up to four slots. Skip retrieval only when the request has no descriptor slot at all, for example an identity-only or fixed-parameter-only request.
- ${RESOLVE_VOCABULARY_TOOL}: pass names exactly as the user wrote them. \`resolved\` pins one identity; \`ambiguous\` returns candidates and you must not choose one yourself; \`unresolved\` means keep the user's text verbatim.
- ${SEARCH_VOCABULARY_TOOL}: up to four slots per call, each with purpose and depth. \`query\` must be a short descriptive phrase copied or condensed from the user's request (for example \`warm tungsten light\`, \`wet cobblestones\`, \`85mm lens\`); never pass a category name or a slot id as the query, because a category name matches nothing. Use \`avoid\` for ids or texts you already rejected so they are not repeated. Identity and NSFW categories are rejected; they are not searchable.
- Candidate ids are the only vocabulary ids you may cite. A supplied row is an unverified community reference, never proof of model compatibility. There is no quota: use a candidate only when it is accurate, and ignoring an unsuitable candidate is a legitimate decision.
- Four strategies per slot: reuse (use a supplied term), adapt (anchor on supplied ids and add context), create (no suitable candidate, write your own), ignore (reject the candidates). Never invent ids.
- Preserve the user's identity anchors, negations, fixed parameters and explicit selections. Do not expand a resolved name into an assumed appearance.
- The current retrieval path is ${path}. When it is entity-only, no search is needed and creativity must not invent visual facts.
- Finish by returning the final JSON composition with initialPrompt, completePrompt, fields and termDecisions, exactly as the output contract requires. When you made no vocabulary decision, return "termDecisions": [] instead of omitting the field.`;
}

function identityWarnings(
  entities: PromptEntityResolution[],
  completePrompt: string,
): string[] {
  const text = completePrompt.toLowerCase();
  const warnings: string[] = [];
  for (const entity of entities) {
    if (entity.status !== "resolved") continue;
    const variants = [
      entity.displayName,
      entity.mention.text,
      entity.candidates[0]?.zh ?? null,
    ]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map((value) => value.trim().toLowerCase());
    if (variants.some((variant) => text.includes(variant))) continue;
    warnings.push(
      `Resolved identity "${entity.displayName ?? entity.mention.text}" is missing from the tool-retrieved prompt.`,
    );
  }
  return warnings;
}

function toolResultMessage(
  callId: string,
  content: string,
): PromptLlmMessage {
  return { role: "tool", toolCallId: callId, content };
}

/**
 * Runs the real multi-turn tool loop. The model decides how often to query and
 * when to stop; Core only enforces category policy, budget, dedupe, conflict
 * filtering and the final decision format.
 */
export async function runToolRetrieval(
  options: ToolRetrievalOptions,
): Promise<ToolRetrievalResult> {
  if (typeof options.llm.completeWithTools !== "function") {
    throw new Error("The selected model does not support tool calling");
  }
  const completeWithTools = options.llm.completeWithTools.bind(options.llm);
  const mode = options.input.mode ?? "expand";
  const state: VocabularyToolState = createVocabularyToolState({
    input: options.input,
    vocabulary: options.vocabulary,
    explicitTerms: options.explicitTerms,
    ...(options.trace ? { trace: options.trace } : {}),
  });
  const base = buildCompositionMessages(
    options.input,
    options.explicitTerms,
    options.modelDirectives,
    options.entities ?? [],
  );
  const tools = vocabularyToolDefinitions();
  const messages: PromptLlmMessage[] = [
    { role: "system", content: `${base.system}\n${toolContract(options.routePlan)}` },
    { role: "user", content: base.user },
  ];
  const entityOnly = options.routePlan?.path === "entity-only";
  const contextTokens = options.input.systemPromptLayerContextSize ?? 8192;
  let content = "";
  let rounds = 0;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    state.round = round + 1;
    if (options.signal?.aborted) {
      throw new Error("Orchestration was cancelled");
    }
    const exhausted = state.calls >= MAX_TOOL_CALLS;
    const finalTurn = round === MAX_TOOL_ROUNDS - 1 || exhausted || entityOnly;
    options.onEvent?.({
      type: "phase",
      stage: finalTurn ? "compose" : "retrieval",
      round: round + 1,
    });
    // The first turn forces one retrieval so a small local model cannot skip the
// library silently; later turns return to `auto` and the model decides when
// to stop. Identity-only requests need no search and keep `auto`.
    // Keep forcing until one retrieval happened: a small local model sometimes
    // ignores `required` on the first turn. Identity-only requests need no
    // search and keep `auto`.
    const forcedFirstTurn =
      state.calls === 0 && !finalTurn && !entityOnly;
    const response = await completeWithTools({
      messages,
      tools,
      mode,
      // Images live in the first user message; resending them on every round
      // would duplicate the payload.
      ...(round === 0 && options.input.imageUrls
        ? { imageUrls: options.input.imageUrls }
        : {}),
      // A tool-call turn normally returns a short JSON decision, but the model may
      // legitimately finish early; keep enough budget to avoid truncating a real
      // composition. The output share is capped by what the declared context
      // still has room for, so a small local window cannot be overrun.
      maxTokens: outputBudget(
        messages,
        contextTokens,
        finalTurn ? 8192 : 4096,
      ),
      toolChoice: finalTurn ? "none" : forcedFirstTurn ? "required" : "auto",
      ...(finalTurn && options.onEvent
        ? { stream: createStreamCallbacks(options.onEvent) }
        : {}),
    });
    if (!finalTurn && response.toolCalls.length > 0) {
      rounds += 1;
      messages.push({
        role: "assistant",
        content: response.content,
        toolCalls: response.toolCalls,
      });
      const allowed = Math.max(0, MAX_TOOL_CALLS - state.calls);
      response.toolCalls.forEach((call, index) => {
        if (index < allowed) {
          state.calls += 1;
          const outcome = executeVocabularyTool(call.name, call.arguments, state);
          messages.push(toolResultMessage(call.id, outcome.content));
          return;
        }
        messages.push(
          toolResultMessage(
            call.id,
            JSON.stringify({
              error: "tool_budget_exhausted",
              message: "Tool call budget reached; produce the final composition now.",
            }),
          ),
        );
      });
      if (state.calls >= MAX_TOOL_CALLS) {
        state.warnings.push(
          `Tool retrieval stopped after ${MAX_TOOL_CALLS} calls; the final answer was forced.`,
        );
      }
      continue;
    }
    content = response.content;
    break;
  }

  if (!content.trim()) {
    throw new Error("Tool loop finished without a final composition");
  }
  const composition = parsePromptComposition(content, mode, options.input.includePayload);
  const available = availableTerms(
    options.explicitTerms,
    state.visible,
    options.vocabulary,
  );
  const parsed = parseTermDecisions(content, available, "Tool retrieval");
  assertNoConflicts(options.vocabulary, options.explicitTerms, parsed.usedTerms);
  const selected = new Map(
    options.explicitTerms
      .filter((term) => term.selectionReason !== "reference")
      .map((term) => [term.id, term]),
  );
  for (const term of parsed.usedTerms) {
    if (!selected.has(term.id)) selected.set(term.id, term);
  }
  return {
    composition,
    selectedTerms: [...selected.values()],
    termDecisions: parsed.decisions,
    retrievalTrace: state.trace.snapshot(),
    retrievalSummary: {
      rounds,
      queryCount: state.queryCount,
      candidateCount: state.candidateCount,
    },
    warnings: [
      ...state.warnings,
      ...parsed.warnings,
      ...identityWarnings(options.entities ?? [], composition.completePrompt),
    ],
  };
}