import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  PromptRetrievalSummary,
  PromptRetrievalTrace,
  PromptTermDecision,
  PromptTermDecisionStrategy,
} from "@prompthub/shared/types";
import { PromptRetrievalTracePanel } from "./PromptRetrievalTracePanel";

type DecisionFilter = "all" | PromptTermDecisionStrategy;

const FILTERS: DecisionFilter[] = ["all", "reuse", "adapt", "create", "ignore"];
const STRATEGY_CLASSES: Record<PromptTermDecisionStrategy, string> = {
  reuse: "bg-primary/10 text-primary",
  adapt: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  create: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  ignore: "bg-muted text-muted-foreground",
};

interface Props {
  decisions: PromptTermDecision[];
  summary?: PromptRetrievalSummary;
  trace?: PromptRetrievalTrace;
}

function DecisionCard({ decision }: { decision: PromptTermDecision }) {
  const { t } = useTranslation();
  return (
    <article
      className="space-y-3 rounded-lg border border-border bg-background/60 p-3"
      data-testid={`orchestrator-decision-${decision.strategy}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded px-2 py-1 text-[11px] font-medium ${STRATEGY_CLASSES[decision.strategy]}`}>
          {t(`orchestrator.dynamicPolish.strategy.${decision.strategy}`)}
        </span>
        <span className="text-[11px] font-medium text-muted-foreground">
          {decision.category} · {decision.slotId}
        </span>
        {decision.origin && (
          <span className="rounded bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
            {t(`orchestrator.provenance.decisionOrigin.${decision.origin}`)}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 overflow-hidden rounded-md border border-border/70">
        <div className="border-r border-border/70 bg-muted/20 p-2.5">
          <h5 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("orchestrator.dynamicPolish.source")}
          </h5>
          <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">
            {decision.sourceText}
          </p>
        </div>
        <div className="p-2.5">
          <h5 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("orchestrator.dynamicPolish.output")}
          </h5>
          <p className="whitespace-pre-wrap break-words text-xs leading-relaxed">
            {decision.strategy === "ignore"
              ? t("orchestrator.dynamicPolish.ignoredOutput")
              : decision.output}
          </p>
        </div>
      </div>
      {decision.terms.length > 0 && (
        <div className="space-y-1.5">
          <h5 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("orchestrator.dynamicPolish.terms")}
          </h5>
          <div className="flex flex-wrap gap-1.5">
            {decision.terms.map((term) => (
              <span
                key={term.id}
                className="max-w-full rounded bg-muted px-2 py-1 text-[11px] leading-relaxed"
                title={term.id}
              >
                <span className="block break-words">{term.en}</span>
                {term.zh && term.zh !== term.en && (
                  <span className="block break-words text-muted-foreground">{term.zh}</span>
                )}
              </span>
            ))}
          </div>
        </div>
      )}
      {decision.rationale && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          <span className="mr-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
            {decision.origin === "model"
              ? t("orchestrator.evidence.modelClaim")
              : t("orchestrator.evidence.policyNote")}
          </span>
          <span className="whitespace-pre-wrap">{decision.rationale}</span>
        </p>
      )}
    </article>
  );
}

export function PromptTermDecisionPanel({ decisions, summary, trace }: Props) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<DecisionFilter>("all");
  useEffect(() => setFilter("all"), [decisions]);
  const visible = filter === "all"
    ? decisions
    : decisions.filter((decision) => decision.strategy === filter);

  return (
    <div className="space-y-3" data-testid="orchestrator-term-decisions">
      {summary && (
        <p className="rounded-md bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
          {t("orchestrator.dynamicPolish.summary", {
            rounds: summary.rounds,
            queries: summary.queryCount,
            candidates: summary.candidateCount,
          })}
        </p>
      )}
      {trace && <PromptRetrievalTracePanel trace={trace} />}
      <div className="flex flex-wrap gap-1.5" aria-label={t("orchestrator.dynamicPolish.tab")}>
        {FILTERS.map((value) => {
          const count = value === "all"
            ? decisions.length
            : decisions.filter((decision) => decision.strategy === value).length;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                filter === value
                  ? "bg-primary/10 text-primary"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
              data-testid={`orchestrator-decision-filter-${value}`}
            >
              <span>
                {value === "all"
                  ? t("orchestrator.dynamicPolish.all")
                  : t(`orchestrator.dynamicPolish.strategy.${value}`)}
              </span>
              <span className="opacity-70">{count}</span>
            </button>
          );
        })}
      </div>
      {visible.length > 0 ? (
        visible.map((decision, index) => (
          <DecisionCard key={`${decision.slotId}-${decision.strategy}-${index}`} decision={decision} />
        ))
      ) : (
        <p className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
          {t("orchestrator.dynamicPolish.empty")}
        </p>
      )}
    </div>
  );
}
