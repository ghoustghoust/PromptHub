import type {
  PromptAssemblyReport,
  PromptEvidenceLedger,
  PromptModelDirective,
  PromptOrchestrationField,
  PromptOrchestrationInput,
  PromptRetrievalSummary,
  PromptSelectedTerm,
  PromptTermDecision,
} from "@prompthub/shared/types";

export interface RunEvidenceOptions {
  input: PromptOrchestrationInput;
  completePrompt: string;
  fields: PromptOrchestrationField[];
  selectedTerms: PromptSelectedTerm[];
  decisions: PromptTermDecision[];
  directives: PromptModelDirective[];
  retrieval?: PromptRetrievalSummary;
  /** True when Core serialized the MOSS layout itself. */
  layoutCompiled: boolean;
}

export interface RunEvidenceResult {
  assembly: PromptAssemblyReport;
  evidence: PromptEvidenceLedger;
  warnings: string[];
}

/**
 * Vocabulary rows use storage syntax (`torn_shorts`, `((wash painting))`)
 * while the prompt uses written syntax. Comparison must ignore that
 * difference, otherwise every such term is reported as missing.
 */
function normalized(value: string): string {
  return value
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/[()[\]{}]/g, " ")
    .replace(/[,;，；、]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A CJK term is a localized explanation; it is not expected verbatim. */
const CJK_TEXT = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/;

interface CheckableFact {
  /** Human-readable requirement, also used as the report entry. */
  label: string;
  text: string;
}

/**
 * Only machine-checkable facts are verified word for word. Free-form intent,
 * constraints and atmosphere are semantic requirements: rewriting them is the
 * model's job, so they are never reported as missing facts.
 */
function checkableFacts(options: RunEvidenceOptions): CheckableFact[] {
  const facts: CheckableFact[] = [];
  for (const term of options.selectedTerms) {
    if (term.selectionReason !== "explicit") continue;
    // The English form is the executable wording the prompt itself uses; a
    // localized template or CJK row is an explanation, not a literal fact.
    const text = (term.en || term.template || "").trim();
    if (!text) continue;
    // A locked term is a promise: it must survive verbatim whatever language
    // the row uses. A merely recommended CJK row may legitimately be
    // translated into an English prompt, so it is not checked literally.
    if (!term.locked && CJK_TEXT.test(text)) continue;
    facts.push({ label: text, text });
  }
  for (const directive of options.directives) {
    for (const word of directive.triggerWords) {
      const text = word.trim();
      if (text) facts.push({ label: text, text });
    }
  }
  // Canvas dimensions are structural: the layout serializer normalizes boxes
  // against them, so they are never expected to appear as literal text.
  return facts;
}

export function buildRunEvidence(options: RunEvidenceOptions): RunEvidenceResult {
  const output = normalized(options.completePrompt);
  const verifiedFacts: string[] = [];
  const missingFacts: string[] = [];
  const warnings: string[] = [];
  for (const fact of checkableFacts(options)) {
    if (output.includes(normalized(fact.text))) {
      verifiedFacts.push(fact.label);
      continue;
    }
    missingFacts.push(fact.label);
    warnings.push(
      `Fixed requirement "${fact.label}" is missing from the final prompt; Core did not rewrite the model text.`,
    );
  }

  const deterministicParts: PromptAssemblyReport["deterministicParts"] = [
    "fixed-fields",
  ];
  if (options.selectedTerms.length > 0) deterministicParts.push("selected-vocabulary");
  if (options.layoutCompiled) deterministicParts.push("layout-json");

  const modelDecisions = options.decisions.filter(
    (decision) => decision.origin !== "policy",
  ).length;
  const policyDecisions = options.decisions.filter(
    (decision) => decision.origin === "policy",
  ).length;

  return {
    assembly: {
      strategy: options.layoutCompiled ? "deterministic" : "model-assisted",
      deterministicParts,
      verifiedFacts,
      missingFacts,
    },
    evidence: {
      observations: {
        retrievalRounds: options.retrieval?.rounds ?? 0,
        retrievalQueries: options.retrieval?.queryCount ?? 0,
        candidatesShown: options.retrieval?.candidateCount ?? 0,
        knowledgeModules: options.input.knowledgeModules?.length ?? 0,
        referenceCards: options.input.referenceStyles?.length ?? 0,
        modelDecisions,
        policyDecisions,
        fixedFields: options.fields.filter((field) => field.layer === "fixed").length,
      },
      // A rationale explains the model's choice; it is never treated as proof.
      modelClaims: modelDecisions,
      // No single run can attribute downstream image quality to one cause.
      effectInferences: [],
    },
    warnings,
  };
}