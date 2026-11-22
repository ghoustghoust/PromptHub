import { useTranslation } from "react-i18next";
import { BrushIcon, ScanSearchIcon } from "lucide-react";
import type {
  PromptArtistRoute,
  PromptEntityCandidate,
  PromptEntityResolution,
  PromptOrchestrationResult,
} from "@prompthub/shared/types";

interface Props {
  result: PromptOrchestrationResult;
}

function statusClass(status: PromptEntityResolution["status"]): string {
  if (status === "resolved") return "bg-primary/10 text-primary";
  if (status === "ambiguous") return "bg-yellow-500/15 text-yellow-700 dark:text-yellow-300";
  return "bg-muted text-muted-foreground";
}

function CandidateChips({ candidates }: { candidates: PromptEntityCandidate[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {candidates.map((candidate) => (
        <span
          key={candidate.identityKey}
          className="rounded bg-muted px-2 py-1 text-[11px] text-muted-foreground"
          title={candidate.termIds.join(", ")}
        >
          {candidate.displayName}
          {candidate.category === "artist" && " · artist"}
          {candidate.series && !candidate.displayName.includes(candidate.series)
            ? ` · ${candidate.series}`
            : ""}
        </span>
      ))}
    </div>
  );
}

function EntityRow({ entity }: { entity: PromptEntityResolution }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2 rounded-lg border border-border p-3" data-testid="orchestrator-entity-row">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs">{entity.mention.text}</span>
        <span className={`rounded px-2 py-0.5 text-[11px] ${statusClass(entity.status)}`}>
          {t(`orchestrator.entityPanel.statuses.${entity.status}`)}
        </span>
        {entity.displayName && (
          <span className="text-xs font-medium">{entity.displayName}</span>
        )}
      </div>
      {entity.status === "resolved" && entity.candidates[0] && (
        <p className="text-[11px] text-muted-foreground">
          {t("orchestrator.entityPanel.identity")}:{" "}
          <span className="font-mono">{entity.candidates[0].termIds.join(", ")}</span>
          {entity.candidates[0].hasAppearanceBundle && (
            <> · {t("orchestrator.entityPanel.appearanceSeparate")}</>
          )}
        </p>
      )}
      {entity.status === "ambiguous" && (
        <div className="space-y-1">
          <p className="text-[11px] text-yellow-700 dark:text-yellow-300">
            {t("orchestrator.entityPanel.ambiguousHint")}
          </p>
          <CandidateChips candidates={entity.candidates} />
        </div>
      )}
      {entity.status === "unresolved" && (
        <p className="text-[11px] text-muted-foreground">
          {t("orchestrator.entityPanel.notInLibrary")}
        </p>
      )}
    </div>
  );
}

function ArtistCard({ route }: { route: PromptArtistRoute }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2 rounded-lg border border-border p-3" data-testid="orchestrator-artist-route">
      <div className="flex flex-wrap items-center gap-2">
        <BrushIcon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        <span className="text-xs font-medium">{route.artistName}</span>
        <span className="rounded bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
          {t(`orchestrator.entityPanel.pipelines.${route.pipeline}`)}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {route.promptToken
            ? `${t("orchestrator.entityPanel.promptToken")}: ${route.promptToken}`
            : t("orchestrator.entityPanel.notInPrompt")}
        </span>
      </div>
      {route.injection && (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
          {[
            ["artistName", route.injection.artistName],
            ["bank", route.injection.bank],
            ["styleGuidance", String(route.injection.styleGuidance)],
            ["adapterStrength", String(route.injection.adapterStrength)],
            ["baseModel", route.injection.baseModel],
          ].map(([key, value]) => (
            <div key={key} className="col-span-2 flex items-baseline justify-between gap-3 border-b border-border/60 py-1 last:border-0 sm:col-span-1">
              <dt className="text-muted-foreground">
                {t(`orchestrator.entityPanel.fields.${key}`)}
              </dt>
              <dd className="font-mono">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="text-[11px] text-muted-foreground">{t("orchestrator.entityPanel.routeNote")}</p>
    </div>
  );
}

export function PromptEntityResolutionPanel({ result }: Props) {
  const { t } = useTranslation();
  const entities = result.entityResolutions ?? [];
  const routes = result.artistRoutes ?? [];
  if (entities.length === 0 && routes.length === 0) {
    return <p className="text-xs text-muted-foreground">{t("orchestrator.entityPanel.empty")}</p>;
  }
  return (
    <div className="space-y-4">
      {result.routePlan && (
        <div className="flex flex-wrap gap-2 text-[11px]">
          <span className="rounded-md bg-primary/10 px-2 py-1 text-primary">
            {t(`orchestrator.entityPanel.paths.${result.routePlan.path}`)}
          </span>
          <span className="rounded-md bg-muted px-2 py-1 text-muted-foreground">
            {result.routePlan.allowCreate
              ? t("orchestrator.entityPanel.createAllowed")
              : t("orchestrator.entityPanel.createBlocked")}
          </span>
        </div>
      )}
      {entities.length > 0 && (
        <section className="space-y-2">
          <h4 className="flex items-center gap-2 text-xs font-semibold">
            <ScanSearchIcon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            {t("orchestrator.entityPanel.entities")}
          </h4>
          {entities.map((entity) => (
            <EntityRow key={`${entity.mention.start}-${entity.mention.text}`} entity={entity} />
          ))}
        </section>
      )}
      {routes.length > 0 && (
        <section className="space-y-2">
          <h4 className="text-xs font-semibold">{t("orchestrator.entityPanel.title")}</h4>
          {routes.map((route) => (
            <ArtistCard key={`${route.termId}-${route.pipeline}`} route={route} />
          ))}
        </section>
      )}
    </div>
  );
}