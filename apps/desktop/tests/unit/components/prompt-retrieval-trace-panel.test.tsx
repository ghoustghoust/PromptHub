import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PromptRetrievalTrace } from "@prompthub/shared/types";
import { PromptRetrievalTracePanel } from "../../../src/renderer/components/prompt/PromptRetrievalTracePanel";
import { PromptTermDecisionPanel } from "../../../src/renderer/components/prompt/PromptTermDecisionPanel";
import { renderWithI18n } from "../../helpers/i18n";

const trace: PromptRetrievalTrace = {
  searches: [
    {
      round: 1,
      origin: "model",
      slotId: "lighting",
      category: "lighting",
      query: "soft light",
      alternateQuery: "柔和光线",
      purpose: "compare",
      depth: "focused",
      status: "match",
      escalated: false,
      truncated: true,
      candidates: [
        {
          id: "light-1",
          en: "soft light",
          zh: "柔光",
          match: "exact",
          relation: "equivalent",
          score: 42,
          status: "presented",
        },
        {
          id: "light-2",
          en: "golden hour",
          zh: null,
          match: "lexical",
          relation: "related",
          score: 12,
          status: "duplicate",
        },
      ],
    },
  ],
  identities: [
    {
      round: 2,
      origin: "model",
      term: "ganyu",
      status: "resolved",
      displayName: "Ganyu",
      candidates: [],
    },
  ],
  errors: [],
  fallbacks: [
    {
      from: "tool-retrieval",
      to: "plain-composition",
      reason: "tool unavailable",
    },
  ],
};

describe("PromptRetrievalTracePanel", () => {
  it("shows the actual query, candidate outcomes, identity lookup and fallback", async () => {
    await renderWithI18n(<PromptRetrievalTracePanel trace={trace} />, { language: "en" });

    expect(screen.getByTestId("retrieval-trace")).toBeTruthy();
    expect(screen.getByTestId("retrieval-fallback-0").textContent).toContain("tool unavailable");
    fireEvent.click(screen.getByTestId("retrieval-query-toggle-0"));

    const query = screen.getByTestId("retrieval-query-0");
    expect(query.textContent).toContain("soft light");
    expect(query.textContent).toContain("柔和光线");
    expect(screen.getByTestId("retrieval-candidate-light-1").textContent).toContain("presented");
    expect(screen.getByTestId("retrieval-candidate-light-2").textContent).toContain("duplicate");
    expect(screen.getByTestId("retrieval-identity-0").textContent).toContain("ganyu");
    expect(screen.getByTestId("retrieval-identity-0").textContent).toContain("resolved");
  });

  it("is available from the existing strategy comparison panel", async () => {
    await renderWithI18n(<PromptTermDecisionPanel decisions={[]} trace={trace} />, {
      language: "en",
    });

    expect(screen.getByTestId("orchestrator-term-decisions")).toBeTruthy();
    expect(screen.getByTestId("retrieval-trace")).toBeTruthy();
  });
});
