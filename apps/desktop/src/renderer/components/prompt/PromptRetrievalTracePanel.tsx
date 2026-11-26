import { useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  PromptRetrievalCandidateTrace,
  PromptRetrievalSearchTrace,
  PromptRetrievalTrace,
} from "@prompthub/shared/types";

interface Props {
  trace: PromptRetrievalTrace;
}

function Candidate({ candidate }: { candidate: PromptRetrievalCandidateTrace }) {
  const { t } = useTranslation();
  return (
    <li
      className="rounded border border-border/60 px-2 py-1.5"
      data-testid={`retrieval-candidate-${candidate.id}`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">
          {t(`orchestrator.retrievalTrace.candidateStatus.${candidate.status}`)}
        </span>
        <span className="font-medium">{candidate.en}</span>
        {candidate.zh && candidate.zh !== candidate.en && (
          <span className="text-muted-foreground">{candidate.zh}</span>
        )}
      </div>
      <div className="mt-0.5 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
        {candidate.match && (
          <span>{t(`orchestrator.retrievalTrace.match.${candidate.match}`)}</span>
        )}
        {candidate.relation && (
          <span>{t(`orchestrator.retrievalTrace.relation.${candidate.relation}`)}</span>
        )}
        {candidate.score !== undefined && (
          <span>{t("orchestrator.retrievalTrace.score", { score: candidate.score.toFixed(2) })}</span>
        )}
      </div>
      {candidate.reason && (
        <p className="mt-0.5 text-[10px] text-muted-foreground">{candidate.reason}</p>
      )}
    </li>
  );
}

function SearchDetails({ search, index }: { search: PromptRetrievalSearchTrace; index: number }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2 border-t border-border/60 pt-2" data-testid={`retrieval-query-${index}`}>
      <div className="flex flex-wrap gap-2 text-[10px] text-muted-foreground">
        <span>{t(`orchestrator.retrievalTrace.purpose.${search.purpose}`)}</span>
        <span>{t(`orchestrator.retrievalTrace.depth.${search.depth}`)}</span>
        <span>{t(`orchestrator.retrievalTrace.searchStatus.${search.status}`)}</span>
        {search.escalated && <span>{t("orchestrator.retrievalTrace.escalated")}</span>}
        {search.truncated && <span>{t("orchestrator.retrievalTrace.truncated")}</span>}
      </div>
      {search.alternateQuery && (
        <p className="text-[11px] text-muted-foreground">
          {t("orchestrator.retrievalTrace.alternate", { query: search.alternateQuery })}
        </p>
      )}
      {search.candidates.length > 0 ? (
        <ul className="space-y-1">
          {search.candidates.map((candidate, candidateIndex) => (
            <Candidate
              key={`${candidate.id}-${candidate.status}-${candidateIndex}`}
              candidate={candidate}
            />
          ))}
        </ul>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          {t("orchestrator.retrievalTrace.noCandidates")}
        </p>
      )}
    </div>
  );
}

/** Observable retrieval evidence; no hidden model reasoning is shown. */
export function PromptRetrievalTracePanel({ trace }: Props) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState<number[]>([]);
  const hasContent = trace.searches.length > 0 || trace.identities.length > 0 ||
    trace.errors.length > 0 || trace.fallbacks.length > 0;
  if (!hasContent) return null;

  return (
    <section className="space-y-2 rounded-lg border border-border bg-background/60 p-3" data-testid="retrieval-trace">
      <div>
        <h4 className="text-xs font-semibold">{t("orchestrator.retrievalTrace.title")}</h4>
        <p className="text-[11px] text-muted-foreground">
          {t("orchestrator.retrievalTrace.summary", {
            searches: trace.searches.length,
            identities: trace.identities.length,
          })}
        </p>
      </div>

      {trace.fallbacks.map((fallback, index) => (
        <div
          key={`${fallback.from}-${fallback.to}-${index}`}
          className="rounded border border-amber-500/40 bg-amber-500/5 px-2 py-1.5 text-[11px]"
          data-testid={`retrieval-fallback-${index}`}
        >
          <span className="font-medium">
            {t(`orchestrator.retrievalTrace.path.${fallback.from}`, fallback.from)}
            {" → "}
            {t(`orchestrator.retrievalTrace.path.${fallback.to}`, fallback.to)}
          </span>
          <p className="text-muted-foreground">{fallback.reason}</p>
        </div>
      ))}

      {trace.errors.map((error, index) => (
        <div
          key={`${error.tool}-${index}`}
          className="rounded border border-destructive/40 px-2 py-1.5 text-[11px]"
          data-testid={`retrieval-error-${index}`}
        >
          <span className="font-medium">{error.tool} · {error.error}</span>
          <p className="text-muted-foreground">{error.message}</p>
        </div>
      ))}

      <div className="space-y-1.5">
        {trace.searches.map((search, index) => {
          const isExpanded = expanded.includes(index);
          return (
            <article key={`${search.round}-${search.slotId}-${index}`} className="rounded-md border border-border/70 p-2">
              <button
                type="button"
                className="flex w-full flex-wrap items-center justify-between gap-2 text-left"
                aria-expanded={isExpanded}
                onClick={() => setExpanded((current) =>
                  current.includes(index)
                    ? current.filter((entry) => entry !== index)
                    : [...current, index])}
                data-testid={`retrieval-query-toggle-${index}`}
              >
                <span className="text-[11px] font-medium">
                  {t("orchestrator.retrievalTrace.queryTitle", {
                    round: search.round,
                    category: search.category,
                    slot: search.slotId,
                    query: search.query,
                  })}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {isExpanded
                    ? t("orchestrator.retrievalTrace.hideDetails")
                    : t("orchestrator.retrievalTrace.showDetails")}
                </span>
              </button>
              {isExpanded && <SearchDetails search={search} index={index} />}
            </article>
          );
        })}
      </div>

      {trace.identities.length > 0 && (
        <div className="space-y-1.5">
          <h5 className="text-[11px] font-semibold text-muted-foreground">
            {t("orchestrator.retrievalTrace.identities")}
          </h5>
          {trace.identities.map((identity, index) => (
            <div
              key={`${identity.term}-${index}`}
              className="rounded-md border border-border/70 px-2 py-1.5 text-[11px]"
              data-testid={`retrieval-identity-${index}`}
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <span>{identity.term}</span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">
                  {t(`orchestrator.retrievalTrace.identityStatus.${identity.status}`)}
                </span>
                {identity.displayName && <span className="font-medium">{identity.displayName}</span>}
              </div>
              {identity.candidates.length > 0 && (
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {identity.candidates.map((candidate) => candidate.displayName).join(" · ")}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
