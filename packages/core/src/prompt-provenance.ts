import type { PromptVocabDB } from "@prompthub/db";
import type {
  PromptArtistRoute,
  PromptEntityResolution,
  PromptOrchestrationField,
  PromptOrchestrationInput,
  PromptProvenanceEntry,
  PromptSelectedTerm,
  PromptTerm,
  PromptTermDecision,
} from "@prompthub/shared/types";

interface ProvenanceOptions {
  input: PromptOrchestrationInput;
  vocabulary: PromptVocabDB;
  terms: PromptSelectedTerm[];
  decisions?: PromptTermDecision[];
  entities: PromptEntityResolution[];
  artistRoutes: PromptArtistRoute[];
  fields: PromptOrchestrationField[];
  completePrompt: string;
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function termText(term: PromptSelectedTerm | PromptTerm): string {
  return term.template?.trim() || term.en;
}

function termState(term: PromptSelectedTerm): PromptProvenanceEntry["state"] {
  if (term.locked) return "locked";
  if (term.selectionReason === "reference") return "reference";
  if (term.selectionReason === "explicit") return "recommended";
  if (term.selectionReason === "random") return "random";
  return "auto";
}

interface TermOutcome {
  outcome: PromptProvenanceEntry["outcome"];
  excerpt: string;
}

function termOutcome(
  term: PromptSelectedTerm,
  fields: PromptOrchestrationField[],
  completePrompt: string,
): TermOutcome {
  const text = termText(term);
  const linked = fields.filter((field) => field.termId === term.id);
  const explicit = term.selectionReason === "explicit" || term.locked;
  if (linked.length > 0) {
    const value = linked[0].value;
    return {
      outcome: explicit ? "fixed" : normalize(value) === normalize(text) ? "verbatim" : "adapted",
      excerpt: value,
    };
  }
  if (text.length >= 2 && normalize(completePrompt).includes(normalize(text))) {
    return { outcome: explicit ? "fixed" : "verbatim", excerpt: text };
  }
  return { outcome: "absent", excerpt: "" };
}

function decisionFor(
  termId: string,
  decisions: PromptTermDecision[] | undefined,
): PromptTermDecision | undefined {
  return decisions?.find((decision) =>
    decision.terms.some((term) => term.id === termId));
}

function constraintEntries(input: PromptOrchestrationInput): PromptProvenanceEntry[] {
  const entries: PromptProvenanceEntry[] = [];
  const values = [...(input.fixedDetails ?? []), ...(input.constraints ?? [])];
  values.forEach((value, index) => {
    const text = value.trim();
    if (!text) return;
    entries.push({
      id: `field:constraint-${index + 1}`,
      kind: "constraint",
      label: text,
      state: "locked",
      outcome: "fixed",
      excerpt: text,
      origin: "user",
      reason: "User-supplied fixed detail or constraint.",
    });
  });
  return entries;
}

function knowledgeModuleEntries(input: PromptOrchestrationInput): PromptProvenanceEntry[] {
  return (input.knowledgeModules ?? []).map((module) => ({
    id: `module:${module.id}`,
    kind: "module",
    label: module.title,
    state: "locked",
    outcome: "injected",
    excerpt: module.content.trim().slice(0, 200),
    origin: "user",
    reason: `Knowledge module${module.packName ? ` from ${module.packName}` : ""} injected into the writing layer (${module.layer ?? "H"}).`,
  }));
}

/**
 * Builds the cross-mode decision trail. Terms are linked to the fields they
 * produced, identities to their fixed identity field, and artist routes to
 * either a prompt token or an injection block. Excluded rows stay visible with
 * no excerpt so the user can see that exclusion won.
 */
export function buildProvenance(options: ProvenanceOptions): PromptProvenanceEntry[] {
  const entries: PromptProvenanceEntry[] = [];
  const seenTermIds = new Set<string>();

  for (const term of options.terms) {
    const { outcome, excerpt } = termOutcome(term, options.fields, options.completePrompt);
    const decision = decisionFor(term.id, options.decisions);
    entries.push({
      id: `term:${term.id}`,
      kind: "term",
      label: termText(term),
      state: termState(term),
      outcome,
      excerpt,
      origin: term.selectionReason === "explicit" || term.locked ? "user" : "policy",
      termId: term.id,
      ...(decision ? { slotId: decision.slotId, strategy: decision.strategy } : {}),
      ...(decision ? { reason: decision.rationale } : {}),
    });
    seenTermIds.add(term.id);
  }

  for (const entity of options.entities) {
    if (entity.termId && seenTermIds.has(entity.termId)) continue;
    const identityField = entity.termId
      ? options.fields.find((field) => field.termId === entity.termId)
      : undefined;
    const name = entity.displayName ?? entity.mention.text;
    let outcome: PromptProvenanceEntry["outcome"] = "absent";
    let excerpt = "";
    if (identityField) {
      outcome = "fixed";
      excerpt = identityField.value;
    } else if (name.length >= 2 && normalize(options.completePrompt).includes(normalize(name))) {
      outcome = "verbatim";
      excerpt = name;
    }
    entries.push({
      id: `entity:${entity.mention.start}:${entity.mention.text}`,
      kind: "entity",
      label: name,
      state: entity.status === "resolved" ? "resolved" : entity.status,
      outcome,
      excerpt,
      origin: "user",
      ...(entity.termId ? { termId: entity.termId, slotId: entity.candidates[0]?.category } : {}),
      reason: entity.reason,
    });
  }

  for (const route of options.artistRoutes) {
    const locked = (options.input.lockedTermIds ?? []).includes(route.termId);
    const selected = (options.input.selectedTermIds ?? []).includes(route.termId);
    const injection = route.injection
      ? `artist_name=${route.injection.artistName}; bank=${route.injection.bank}; style_guidance=${route.injection.styleGuidance}; adapter_strength=${route.injection.adapterStrength}; base=${route.injection.baseModel}`
      : "";
    entries.push({
      id: `artist:${route.termId}`,
      kind: "artist",
      label: route.artistName,
      state: locked ? "locked" : selected ? "recommended" : "resolved",
      outcome: route.injection ? "injected" : route.promptToken ? (locked ? "fixed" : "verbatim") : "absent",
      excerpt: route.injection ? injection : route.promptToken ?? "",
      origin: locked || selected ? "user" : "policy",
      termId: route.termId,
      slotId: "artist",
      reason: route.reason,
    });
  }

  entries.push(...constraintEntries(options.input));
  entries.push(...knowledgeModuleEntries(options.input));

  // An excluded term is still worth showing; it explains why a selected-looking
  // id never reached the prompt.
  for (const id of options.input.excludedTermIds ?? []) {
    if (seenTermIds.has(id)) continue;
    const term = options.vocabulary.getTerm(id);
    if (!term) continue;
    entries.push({
      id: `term:${id}`,
      kind: "term",
      label: termText(term),
      state: "excluded",
      outcome: "absent",
      excerpt: "",
      origin: "user",
      termId: id,
      reason: "The user excluded this term; exclusion takes priority.",
    });
  }
  return entries;
}

interface PolicyDecisionOptions {
  terms: PromptSelectedTerm[];
  fields: PromptOrchestrationField[];
  completePrompt: string;
  vocabulary: PromptVocabDB;
  excludedTermIds?: string[];
}

function policyStrategy(
  term: PromptSelectedTerm,
  outcome: PromptProvenanceEntry["outcome"],
): PromptTermDecision["strategy"] {
  if (term.selectionReason === "reference") return outcome === "absent" ? "ignore" : "adapt";
  if (term.selectionReason === "explicit" || term.locked) return "reuse";
  if (outcome === "absent") return "ignore";
  return outcome === "adapted" ? "adapt" : "reuse";
}

/**
 * Derives one decision row per term for modes where the model does not decide.
 * It mirrors the user's states and the actual field usage, so the strategy tab
 * is never empty simply because a different mode produced the result.
 */
export function buildPolicyDecisions(options: PolicyDecisionOptions): PromptTermDecision[] {
  const groups = new Map<string, PromptTermDecision[]>();
  const push = (decision: PromptTermDecision): void => {
    const list = groups.get(decision.slotId) ?? [];
    if (list.length >= 8) return;
    list.push(decision);
    groups.set(decision.slotId, list);
  };

  for (const term of options.terms) {
    const { outcome, excerpt } = termOutcome(term, options.fields, options.completePrompt);
    const strategy = policyStrategy(term, outcome);
    push({
      slotId: term.category,
      category: term.category,
      sourceText: termText(term),
      strategy,
      terms: strategy === "ignore"
        ? []
        : [{ id: term.id, category: term.category, en: term.en, zh: term.zh }],
      output: strategy === "ignore" ? "" : excerpt || termText(term),
      rationale:
        strategy === "reuse"
          ? "Policy decision: the user's term was written as a fixed or exact field."
          : strategy === "adapt"
            ? "Policy decision: the term was used as reference and rephrased."
            : "Policy decision: the term did not reach the final prompt.",
      origin: "policy",
    });
  }

  for (const id of options.excludedTermIds ?? []) {
    const term = options.vocabulary.getTerm(id);
    if (!term) continue;
    push({
      slotId: term.category,
      category: term.category,
      sourceText: termText(term),
      strategy: "ignore",
      terms: [],
      output: "",
      rationale: "Policy decision: the user excluded this term, so it never entered the prompt.",
      origin: "policy",
    });
  }

  return [...groups.values()].flat();
}