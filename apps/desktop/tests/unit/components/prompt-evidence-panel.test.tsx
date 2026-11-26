import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type {
  PromptEvidenceLedger,
  PromptTermDecision,
} from "@prompthub/shared/types";
import { PromptEvidencePanel } from "../../../src/renderer/components/prompt/PromptEvidencePanel";
import { PromptTermDecisionPanel } from "../../../src/renderer/components/prompt/PromptTermDecisionPanel";
import { renderWithI18n } from "../../helpers/i18n";

const evidence: PromptEvidenceLedger = {
  observations: {
    retrievalRounds: 2,
    retrievalQueries: 3,
    candidatesShown: 7,
    knowledgeModules: 1,
    referenceCards: 2,
    modelDecisions: 1,
    policyDecisions: 0,
    fixedFields: 4,
  },
  modelClaims: 1,
  effectInferences: [],
};

function decision(origin: "model" | "policy"): PromptTermDecision {
  return {
    slotId: "lighting",
    category: "lighting",
    sourceText: "warm window light",
    strategy: "reuse",
    terms: [{ id: "light-a", category: "lighting", en: "golden hour", zh: null }],
    output: "golden hour",
    rationale: origin === "model" ? "matched the requested warmth" : "policy: exact field",
    origin,
  };
}

describe("PromptEvidencePanel", () => {
  it("shows assembly strategy, confirmed and missing fixed facts, and counters", async () => {
    await renderWithI18n(
      <PromptEvidencePanel
        assembly={{
          strategy: "model-assisted",
          deterministicParts: ["fixed-fields", "selected-vocabulary"],
          verifiedFacts: ["golden hour"],
          missingFacts: ["moss fidelity"],
        }}
        evidence={evidence}
      />,
      { language: "en" },
    );

    expect(screen.getByTestId("orchestrator-assembly-strategy").textContent).toBe(
      "Model-written",
    );
    expect(screen.getByTestId("orchestrator-verified-facts").textContent).toContain(
      "golden hour",
    );
    expect(screen.getByTestId("orchestrator-missing-facts").textContent).toContain(
      "moss fidelity",
    );
    expect(screen.getByTestId("orchestrator-evidence-queries").textContent).toBe("3");
    expect(screen.getByTestId("orchestrator-evidence-candidates").textContent).toBe("7");
    expect(screen.getByTestId("orchestrator-model-claims").textContent).toContain("1");
    expect(screen.getByTestId("orchestrator-evidence-panel").textContent).toContain(
      "No downstream effect is claimed",
    );
  });

  it("marks the deterministic layout assembly", async () => {
    await renderWithI18n(
      <PromptEvidencePanel
        assembly={{
          strategy: "deterministic",
          deterministicParts: ["fixed-fields", "layout-json"],
          verifiedFacts: [],
          missingFacts: [],
        }}
      />,
      { language: "en" },
    );
    expect(screen.getByTestId("orchestrator-assembly-strategy").textContent).toBe(
      "Core-assembled",
    );
    expect(screen.getByTestId("orchestrator-evidence-panel").textContent).toContain(
      "layout JSON",
    );
  });
});

describe("decision rationale labelling", () => {
  it("labels model rationales as claims and policy text as a note", async () => {
    const { container } = await renderWithI18n(
      <PromptTermDecisionPanel
        decisions={[decision("model"), decision("policy")]}
      />,
      { language: "en" },
    );
    const cards = container.querySelectorAll('[data-testid^="orchestrator-decision-"]');
    expect(cards.length).toBeGreaterThanOrEqual(2);
    expect(container.textContent).toContain("model claim");
    expect(container.textContent).toContain("policy note");
  });
});