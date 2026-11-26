import type { PromptVocabDB } from "@prompthub/db";
import type {
  PromptSelectedTerm,
  PromptTerm,
  PromptTermDecision,
  PromptTermDecisionStrategy,
} from "@prompthub/shared/types";

const MAX_DECISIONS = 32;

export interface ParsedTermDecisions {
  decisions: PromptTermDecision[];
  usedTerms: PromptSelectedTerm[];
  warnings: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseJsonObject(content: string, label: string): Record<string, unknown> {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const parsed: unknown = JSON.parse(fenced?.[1] ?? trimmed);
  if (!isRecord(parsed)) throw new Error(`${label} must be a JSON object`);
  return parsed;
}

export function requiredText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  const text = value.trim();
  if (text.length > maxLength || text.includes("\0")) {
    throw new Error(`${label} exceeds its length limit or contains a null byte`);
  }
  return text;
}

export function optionalText(value: unknown, label: string, maxLength: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return requiredText(value, label, maxLength);
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
    origin: "model",
  };
}

/**
 * One decision contract for every retrieval mode: the model either reused,
 * adapted, created or ignored a slot, and only supplied ids are acceptable.
 * An empty list is valid when no retrieval or candidate use was needed.
 */
export function parseTermDecisions(
  content: string,
  available: Map<string, PromptTerm>,
  label = "Prompt composition",
): ParsedTermDecisions {
  const root = parseJsonObject(content, label);
  if (!Array.isArray(root.termDecisions) || root.termDecisions.length > MAX_DECISIONS) {
    throw new Error(`${label} requires 0 to ${MAX_DECISIONS} termDecisions`);
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

export function availableTerms(
  explicitTerms: PromptSelectedTerm[],
  visible: Map<string, PromptTerm>,
  vocabulary: PromptVocabDB,
): Map<string, PromptTerm> {
  const available = new Map(visible);
  for (const selected of explicitTerms) {
    const term = vocabulary.getTerm(selected.id);
    if (term) available.set(term.id, term);
  }
  return available;
}

export function assertNoConflicts(
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
        `Vocabulary tool selected conflicting terms: ${candidate.id} and ${conflict.id}.`,
      );
    }
    accepted.push(candidate);
  }
}