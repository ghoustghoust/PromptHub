import { PromptVocabDB } from "@prompthub/db";
import type {
  PromptOrchestrationInput,
  PromptSelectedTerm,
  PromptSkillDraft,
  PromptSkillReferenceItem,
  PromptSkillSuggestion,
} from "@prompthub/shared/types";
import type { PromptOrchestratorLlm } from "./prompt-orchestrator-llm";
import { getPromptRuleCard } from "./prompt-orchestrator-rule-cards";
import { selectPromptTerms } from "./prompt-orchestrator-vocabulary";
import { serializeSkillMd } from "./skills/skill-frontmatter";

export interface PromptSkillGeneratorOptions {
  vocabulary: PromptVocabDB;
  llm: PromptOrchestratorLlm;
}

interface GeneratedSkillPayload {
  name?: string;
  description: string;
  workflow: string[];
  suggestions: PromptSkillSuggestion[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function selectedTermText(term: PromptSelectedTerm): string {
  return term.template?.trim() || term.en;
}

function normalizeSkillName(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  return slug || "prompt-skill";
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function parseJson(content: string): Record<string, unknown> {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fenced?.[1] ?? trimmed);
  } catch (error) {
    throw new Error(
      `Skill generator returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isRecord(parsed)) throw new Error("Skill generator JSON must be an object");
  return parsed;
}

function parseWorkflowStep(value: unknown, index: number): string {
  if (typeof value === "string") return requiredText(value, `workflow[${index}]`);
  if (isRecord(value)) {
    for (const key of ["step", "action", "description", "title", "content"]) {
      const nested = value[key];
      if (typeof nested === "string") {
        return requiredText(nested, `workflow[${index}].${key}`);
      }
      if (isRecord(nested)) {
        for (const nestedKey of ["description", "title", "content", "action", "step", "name"]) {
          if (nested[nestedKey] !== undefined) {
            return requiredText(
              nested[nestedKey],
              `workflow[${index}].${key}.${nestedKey}`,
            );
          }
        }
      }
    }
  }
  throw new Error(`workflow[${index}] must be text or a step object`);
}

function parseSuggestion(value: unknown, index: number): PromptSkillSuggestion {
  if (!isRecord(value)) throw new Error(`suggestions[${index}] must be an object`);
  const suggestion: PromptSkillSuggestion = {
    title: requiredText(value.title, `suggestions[${index}].title`),
    content: requiredText(value.content, `suggestions[${index}].content`),
  };
  if (value.rationale !== undefined) {
    suggestion.rationale = requiredText(
      value.rationale,
      `suggestions[${index}].rationale`,
    );
  }
  return suggestion;
}

function parsePayload(content: string): GeneratedSkillPayload {
  const record = parseJson(content);
  if (!Array.isArray(record.workflow) || record.workflow.length === 0) {
    throw new Error("Skill generator workflow must be a non-empty array");
  }
  if (record.workflow.length > 8 || !Array.isArray(record.suggestions)) {
    throw new Error("Skill generator workflow/suggestions shape is invalid");
  }
  if (record.suggestions.length === 0 || record.suggestions.length > 8) {
    throw new Error("Skill generator requires 1-8 creative suggestions");
  }
  return {
    name:
      record.name === undefined
        ? undefined
        : requiredText(record.name, "name"),
    description: requiredText(record.description, "description"),
    workflow: record.workflow.map(parseWorkflowStep),
    suggestions: record.suggestions.map(parseSuggestion),
  };
}

function buildReferences(
  db: PromptVocabDB,
  input: PromptOrchestrationInput,
  selectedTerms: PromptSelectedTerm[],
): PromptSkillReferenceItem[] {
  const ruleCard = input.skill ?? "moodyMoss";
  const references: PromptSkillReferenceItem[] = [{
    kind: "rule-card",
    id: ruleCard,
    label: `Rule card: ${ruleCard}`,
    content: getPromptRuleCard(ruleCard),
  }];
  selectedTerms.forEach((term) => {
    references.push({
      kind: "vocabulary",
      id: term.id,
      label: `Vocabulary: ${term.category}/${term.en}`,
      content: selectedTermText(term),
      validationStatus: term.validationStatus,
    });
  });
  const profileIds = [input.modelId, ...(input.loraIds ?? [])].filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );
  profileIds.forEach((id) => {
    const profile = db.getModelProfile(id);
    if (profile) {
      references.push({
        kind: "model-profile",
        id: profile.id,
        label: `Model profile: ${profile.name}`,
        content: `Kind: ${profile.kind}; triggers: ${profile.triggerWords.join(", ") || "none"}; weight range: ${profile.weightRange ?? "unspecified"}`,
      });
    }
  });
  return references;
}

function fallbackWorkflow(): string[] {
  return [
    "Separate user-fixed requirements, reasonable derivations, and optional creative suggestions.",
    "Apply the selected rule card without mixing incompatible model-specific ordering rules.",
    "Use vocabulary and model profiles only when relevant, preserving their validation status.",
    "Produce the requested output format and review physical, spatial, and evidence coherence.",
  ];
}

function buildBody(
  payload: GeneratedSkillPayload,
  references: PromptSkillReferenceItem[],
): string {
  const workflow = payload.workflow
    .map((step, index) => `${index + 1}. ${step}`)
    .join("\n");
  const referenceText = references
    .map((item) => `- [REFERENCE] ${item.label}: ${item.content}`)
    .join("\n");
  const suggestions = payload.suggestions.length
    ? payload.suggestions
        .map(
          (item) =>
            `- [SUGGESTION] ${item.title}: ${item.content}${item.rationale ? ` — ${item.rationale}` : ""}`,
        )
        .join("\n")
    : "No creative suggestions were generated.";
  return [
    "# Reusable prompt orchestration workflow",
    workflow,
    "# Reference content supplied by PromptHub",
    referenceText,
    "# Creative suggestions (optional, not requirements)",
    suggestions,
  ].join("\n\n");
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 500 ? `${message.slice(0, 500)}...` : message;
}

export class PromptSkillGenerator {
  constructor(private readonly options: PromptSkillGeneratorOptions) {}

  async generate(
    input: PromptOrchestrationInput,
    skillName?: string,
  ): Promise<PromptSkillDraft> {
    const prompt = requiredText(input.prompt, "Skill generation prompt");
    if (prompt.includes("\0")) {
      throw new Error("Skill generation prompt contains a null byte");
    }
    const ruleCard = input.skill ?? "moodyMoss";
    const selection = selectPromptTerms(this.options.vocabulary, input);
    const references = buildReferences(
      this.options.vocabulary,
      input,
      selection.terms,
    );
    const fallbackName = normalizeSkillName(skillName ?? prompt);
    try {
      const payload = await this.generatePayload(input, references);
      const name = normalizeSkillName(skillName ?? payload.name ?? fallbackName);
      return {
        name,
        description: payload.description,
        ruleCard,
        content: serializeSkillMd({
          name,
          description: payload.description,
          version: "1.0.0",
          author: "PromptHub",
          tags: ["prompt-orchestration", ruleCard],
          instructions: buildBody(payload, references),
        }),
        references,
        suggestions: payload.suggestions,
        warnings: selection.warnings,
        status: "complete",
      };
    } catch (error) {
      const description = `Reusable ${ruleCard} prompt orchestration guidance.`;
      const payload: GeneratedSkillPayload = {
        description,
        workflow: fallbackWorkflow(),
        suggestions: [],
      };
      return {
        name: fallbackName,
        description,
        ruleCard,
        content: serializeSkillMd({
          name: fallbackName,
          description,
          version: "1.0.0",
          author: "PromptHub",
          tags: ["prompt-orchestration", ruleCard],
          instructions: buildBody(payload, references),
        }),
        references,
        suggestions: [],
        warnings: [
          ...selection.warnings,
          `Skill LLM generation failed; deterministic fallback used: ${errorMessage(error)}`,
        ],
        status: "degraded",
      };
    }
  }

  private async generatePayload(
    input: PromptOrchestrationInput,
    references: PromptSkillReferenceItem[],
  ): Promise<GeneratedSkillPayload> {
    const outputFormat = input.outputFormat ?? "caption";
    const formatRule =
      outputFormat === "layout"
        ? "The selected output is Layout only. Use the rule card's compiled Layout format and do not switch to plain Caption."
        : "The selected output is Caption only. Never instruct the skill to produce Layout, bbox, yxyx, or layout JSON.";
    const system = [
      "You create reusable PromptHub prompt-orchestration skills, not one-off prompts.",
      "Return one valid JSON object with: name (optional), description, workflow (2-8 reusable steps), suggestions (1-8 creative additions).",
      "Each suggestion needs title, content, and optional rationale. Suggestions are optional ideas, never facts or user requirements.",
      "Every workflow step must be a complete actionable sentence with a verb and purpose, never a short heading or label.",
      "Suggestions must describe visible visual details only: no auditory cues, backstory, invisible facts, or non-visual instructions.",
      "The host inserts exact reference content after your response. Do not repeat references or turn them into creative suggestions.",
      "Follow the supplied rule card and keep suggestions compatible with it.",
      formatRule,
    ].join("\n");
    const user = JSON.stringify({
      intent: input.prompt,
      ruleCard: input.skill ?? "moodyMoss",
      series: input.series ?? null,
      outputFormat,
      references,
    });
    const content = await this.options.llm.complete({
      messages: { system, user },
      mode: "json",
    });
    return parsePayload(content);
  }
}
