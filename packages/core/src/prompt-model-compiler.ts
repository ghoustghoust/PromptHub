import type {
  PromptOrchestrationSkill,
  PromptSharedSemantics,
} from "@prompthub/shared/types";
import {
  getPromptRuleCard,
  type PromptRuleCardOptions,
} from "./prompt-orchestrator-rule-cards";

export type { PromptSharedSemantics };

export interface CompiledModelPrompt {
  /** Shared block; identical for every skill given the same facts. */
  shared: string;
  /** Model-specific rule card; never repeats the shared block. */
  modelRules: string;
  /** Ready-to-use text: shared block first, then the model rules. */
  text: string;
}

const FIELDS: Array<{ key: keyof Omit<PromptSharedSemantics, "constraints">; label: string }> = [
  { key: "subject", label: "Subject" },
  { key: "action", label: "Action" },
  { key: "setting", label: "Setting" },
  { key: "composition", label: "Composition" },
  { key: "lighting", label: "Lighting" },
  { key: "palette", label: "Palette" },
  { key: "continuity", label: "Continuity" },
];

/**
 * Compiles the shared half once. Empty fields are skipped so the block never
 * carries blank lines or placeholder labels.
 */
export function compileSharedSemantics(facts: PromptSharedSemantics): string {
  const lines: string[] = ["Shared scene facts (apply to every target model):"];
  for (const field of FIELDS) {
    const value = facts[field.key]?.trim();
    if (value) lines.push(`- ${field.label}: ${value}`);
  }
  const constraints = (facts.constraints ?? [])
    .map((item) => item.trim())
    .filter(Boolean);
  if (constraints.length > 0) {
    lines.push(`- Constraints: ${constraints.join("; ")}`);
  }
  return lines.join("\n");
}

/**
 * Combines the shared block with one model's native rules. The shared block is
 * emitted once; the rule card is the existing model-specific half unchanged.
 */
export function compileModelPrompt(
  facts: PromptSharedSemantics,
  skill: PromptOrchestrationSkill | undefined,
  options: PromptRuleCardOptions = {},
): CompiledModelPrompt {
  const shared = compileSharedSemantics(facts);
  const modelRules = getPromptRuleCard(skill, options);
  return { shared, modelRules, text: `${shared}\n\n${modelRules}` };
}