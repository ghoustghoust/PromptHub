import { useTranslation } from "react-i18next";
import type {
  PromptTaskContract,
  PromptTaskResourceKey,
} from "@prompthub/shared/types";

/** Order is intentional: what the user picked first, system resources last. */
const RESOURCE_ORDER: PromptTaskResourceKey[] = [
  "vocabulary",
  "vocabularyRetrieval",
  "knowledge",
  "reference",
  "systemPromptLayer",
  "stepContext",
  "images",
  "layout",
  "video",
  "assets",
];

interface Props {
  contract: PromptTaskContract;
  /** One line for the run panel; the full block lives in the result tabs. */
  compact?: boolean;
}

export function PromptTaskContractPanel({ contract, compact = false }: Props) {
  const { t } = useTranslation();
  const allowed = RESOURCE_ORDER.filter(
    (key) => contract.resources[key].allowed,
  );
  const blocked = RESOURCE_ORDER.filter(
    (key) => !contract.resources[key].allowed,
  );
  const resourceLabel = (key: PromptTaskResourceKey) =>
    t(`orchestrator.taskContract.resources.${key}`);

  if (compact) {
    return (
      <div
        className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground"
        data-testid="orchestrator-task-contract"
      >
        <span className="font-medium text-foreground">
          {t(`orchestrator.modes.${contract.taskKind}`)}
        </span>
        <span>
          {contract.writing === "dispatch"
            ? t("orchestrator.taskContract.writing.dispatch")
            : t("orchestrator.taskContract.writing.creative")}
        </span>
        <span>
          {contract.retrieval.automatic
            ? t("orchestrator.taskContract.retrieval.automatic")
            : t("orchestrator.taskContract.retrieval.manual")}
        </span>
        <span>
          {contract.retrieval.modelTools
            ? t("orchestrator.taskContract.tools.compactOn")
            : t("orchestrator.taskContract.tools.off")}
        </span>
        <span title={blocked.map(resourceLabel).join(" · ")}>
          {t("orchestrator.taskContract.compactAllowed", {
            count: allowed.length,
            total: RESOURCE_ORDER.length,
          })}
        </span>
      </div>
    );
  }

  return (
    <section
      className="space-y-3 rounded-lg border border-border bg-muted/20 p-3"
      data-testid="orchestrator-task-contract-detail"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-xs font-semibold">
          {t("orchestrator.taskContract.title")}
        </h4>
        <span className="rounded bg-muted px-2 py-0.5 text-[11px]">
          {t(`orchestrator.modes.${contract.taskKind}`)}
        </span>
        <span className="rounded bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
          {contract.writing === "dispatch"
            ? t("orchestrator.taskContract.writing.dispatch")
            : t("orchestrator.taskContract.writing.creative")}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {contract.retrieval.automatic
            ? t("orchestrator.taskContract.retrieval.automatic")
            : t("orchestrator.taskContract.retrieval.manual")}
          {" · "}
          {contract.retrieval.modelTools
            ? t("orchestrator.taskContract.tools.on", {
                rounds: contract.retrieval.maxRounds,
                calls: contract.retrieval.maxToolCalls,
              })
            : t("orchestrator.taskContract.tools.off")}
          {" · "}
          {contract.retrieval.allowExploratory
            ? t("orchestrator.taskContract.depth.exploratory")
            : t("orchestrator.taskContract.depth.focused")}
        </span>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
          #{contract.signature}
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {allowed.map((key) => (
          <span
            key={key}
            className="rounded border border-border bg-background px-2 py-0.5 text-[11px]"
          >
            {resourceLabel(key)}
            <span className="ml-1 text-[10px] text-muted-foreground">
              {contract.resources[key].source === "automatic"
                ? t("orchestrator.taskContract.sourceAutomatic")
                : t("orchestrator.taskContract.sourceExplicit")}
            </span>
          </span>
        ))}
        {blocked.map((key) => (
          <span
            key={key}
            className="rounded border border-dashed border-border px-2 py-0.5 text-[11px] text-muted-foreground"
            title={t("orchestrator.taskContract.blockedHint")}
          >
            {resourceLabel(key)}
            <span className="ml-1 text-[10px]">
              {t("orchestrator.taskContract.blocked")}
            </span>
          </span>
        ))}
      </div>

      {contract.rejectedResources.length > 0 && (
        <div className="space-y-1" data-testid="orchestrator-task-contract-rejected">
          <p className="text-[11px] font-medium text-amber-700 dark:text-amber-300">
            {t("orchestrator.taskContract.rejected.title")}
          </p>
          <ul className="list-inside list-disc text-[11px] text-muted-foreground">
            {contract.rejectedResources.map((rejection) => (
              <li key={`${rejection.resource}-${rejection.reason}`}>
                {t(`orchestrator.taskContract.rejected.${rejection.reason}`)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        {t("orchestrator.taskContract.hint")}
      </p>
    </section>
  );
}