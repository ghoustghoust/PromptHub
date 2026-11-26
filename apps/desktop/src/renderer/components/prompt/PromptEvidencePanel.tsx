import { useTranslation } from "react-i18next";
import type {
  PromptAssemblyReport,
  PromptEvidenceLedger,
} from "@prompthub/shared/types";

interface Props {
  assembly?: PromptAssemblyReport;
  evidence?: PromptEvidenceLedger;
}

export function PromptEvidencePanel({ assembly, evidence }: Props) {
  const { t } = useTranslation();
  if (!assembly && !evidence) return null;

  const observations = evidence?.observations;
  const counters = observations
    ? [
        ["rounds", observations.retrievalRounds],
        ["queries", observations.retrievalQueries],
        ["candidates", observations.candidatesShown],
        ["knowledge", observations.knowledgeModules],
        ["references", observations.referenceCards],
        ["modelDecisions", observations.modelDecisions],
        ["policyDecisions", observations.policyDecisions],
        ["fixedFields", observations.fixedFields],
      ] as const
    : [];

  return (
    <section
      className="space-y-3 rounded-lg border border-border bg-background/60 p-3"
      data-testid="orchestrator-evidence-panel"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-xs font-semibold">{t("orchestrator.evidence.title")}</h4>
        {assembly && (
          <span
            className="rounded bg-muted px-2 py-0.5 text-[11px]"
            data-testid="orchestrator-assembly-strategy"
          >
            {assembly.strategy === "deterministic"
              ? t("orchestrator.evidence.strategy.deterministic")
              : t("orchestrator.evidence.strategy.modelAssisted")}
          </span>
        )}
        {assembly?.deterministicParts.map((part) => (
          <span
            key={part}
            className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground"
          >
            {t(`orchestrator.evidence.parts.${part}`)}
          </span>
        ))}
      </div>

      {counters.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] sm:grid-cols-4">
          {counters.map(([key, value]) => (
            <div key={key} className="flex items-baseline justify-between gap-2">
              <dt className="text-muted-foreground">
                {t(`orchestrator.evidence.observations.${key}`)}
              </dt>
              <dd className="font-mono" data-testid={`orchestrator-evidence-${key}`}>
                {value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {assembly && assembly.verifiedFacts.length > 0 && (
        <div data-testid="orchestrator-verified-facts">
          <p className="text-[11px] font-medium">{t("orchestrator.evidence.verified")}</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {assembly.verifiedFacts.map((fact) => (
              <span
                key={fact}
                className="rounded bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-700 dark:text-emerald-300"
              >
                {fact}
              </span>
            ))}
          </div>
        </div>
      )}

      {assembly && assembly.missingFacts.length > 0 && (
        <div data-testid="orchestrator-missing-facts">
          <p className="text-[11px] font-medium text-amber-700 dark:text-amber-300">
            {t("orchestrator.evidence.missing")}
          </p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {assembly.missingFacts.map((fact) => (
              <span
                key={fact}
                className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px]"
              >
                {fact}
              </span>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {t("orchestrator.evidence.missingHint")}
          </p>
        </div>
      )}

      <div className="space-y-1 border-t border-border pt-2 text-[11px] text-muted-foreground">
        <p>{t("orchestrator.evidence.boundary")}</p>
        <p data-testid="orchestrator-model-claims">
          {t("orchestrator.evidence.modelClaims", {
            count: evidence?.modelClaims ?? 0,
          })}
        </p>
        <p>{t("orchestrator.evidence.effect")}</p>
      </div>
    </section>
  );
}