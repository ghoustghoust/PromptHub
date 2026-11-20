import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CopyIcon,
  Maximize2Icon,
  Minimize2Icon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import type {
  PromptOrchestrationField,
  PromptOrchestrationResult,
  PromptSkillDraft,
} from "@prompthub/shared/types";
import { Button } from "../ui/Button";
import { Textarea } from "../ui/Textarea";
import { PromptComparisonView } from "./PromptComparisonView";
import { PromptSkillDraftPanel } from "./PromptSkillDraftPanel";
import { PromptMossLayoutResultView } from "./PromptMossLayoutResultView";
import { PromptTermDecisionPanel } from "./PromptTermDecisionPanel";

type ResultTab = "complete" | "decisions" | "initial" | "fields" | "skill";

interface Props {
  result: PromptOrchestrationResult | null;
  sourcePrompt: string;
  skillDraft: PromptSkillDraft | null;
  savedSkillId: string | null;
  isSavingSkill: boolean;
  onSaveSkill: () => void;
  onCopy: (value: string) => void;
  expanded: boolean;
  onToggleExpanded: () => void;
  onClose?: () => void;
  savedPromptId: string | null;
  isSavingToLibrary: boolean;
  onSaveToLibrary: (favorite: boolean) => void;
}

function FieldRow({ field }: { field: PromptOrchestrationField }) {
  const { t } = useTranslation();
  return (
    <tr className="border-b border-border align-top last:border-0">
      <td className="px-3 py-2 font-medium">{field.name}</td>
      <td className="whitespace-pre-wrap px-3 py-2">{field.value}</td>
      <td className="px-3 py-2">
        <span className="rounded bg-muted px-2 py-1 text-[11px]">
          {t(`orchestrator.layers.${field.layer}`)}
        </span>
      </td>
      <td className="px-3 py-2 text-muted-foreground">{field.rationale ?? ""}</td>
    </tr>
  );
}

export function PromptOrchestratorResultPanel({
  result,
  sourcePrompt,
  skillDraft,
  savedSkillId,
  isSavingSkill,
  onSaveSkill,
  onCopy,
  expanded,
  onToggleExpanded,
  onClose,
  savedPromptId,
  isSavingToLibrary,
  onSaveToLibrary,
}: Props) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<ResultTab>("complete");
  const [favorite, setFavorite] = useState(false);
  useEffect(() => {
    setTab(result?.termDecisions?.length ? "decisions" : "complete");
  }, [result]);

  const tabs: Array<{ id: ResultTab; label: string; disabled?: boolean }> = [
    { id: "complete", label: t("orchestrator.completePrompt") },
    {
      id: "decisions",
      label: t("orchestrator.dynamicPolish.tab"),
      disabled: !result?.termDecisions?.length,
    },
    { id: "initial", label: t("orchestrator.initialPrompt") },
    { id: "fields", label: t("orchestrator.fields"), disabled: !result },
    { id: "skill", label: t("orchestrator.skillDraft"), disabled: !skillDraft },
  ];

  return (
    <aside
      className="flex h-full min-h-0 min-w-0 flex-col bg-card/40"      aria-label={t("orchestrator.resultPanel")}
      data-testid="orchestrator-result-panel"
    >
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-2">
        <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto" role="tablist">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              disabled={item.disabled}
              onClick={() => setTab(item.id)}
              className={`shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                tab === item.id
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              } disabled:cursor-not-allowed disabled:opacity-40`}
            >
              {item.label}
            </button>
          ))}
        </div>
        {onClose && (
          <Button
            size="sm"
            variant="ghost"
            aria-label={t("orchestrator.closeResult")}
            onClick={onClose}
            data-testid="orchestrator-result-close"
          >
            <XIcon className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          aria-label={t(expanded ? "orchestrator.collapseResult" : "orchestrator.expandResult")}
          onClick={onToggleExpanded}
          data-testid="orchestrator-result-expand"
        >
          {expanded ? (
            <Minimize2Icon className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <Maximize2Icon className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </Button>
        {result && tab !== "skill" && tab !== "fields" && tab !== "decisions" && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onCopy(tab === "initial" ? result.initialPrompt : result.completePrompt)}
          >
            <CopyIcon className="h-3.5 w-3.5" aria-hidden="true" />
            {t("orchestrator.copy")}
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {!result ? (
          <div className="flex h-full min-h-48 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
            <SparklesIcon className="h-8 w-8" aria-hidden="true" />
            <h2 className="text-sm font-medium">{t("orchestrator.emptyTitle")}</h2>
            <p className="max-w-xs text-xs">{t("orchestrator.emptyDescription")}</p>
          </div>
        ) : tab === "complete" ? (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2 text-[11px]">
              <span className="rounded-md bg-primary/10 px-2 py-1 text-primary">{result.skill}</span>
              {result.outputFormat && (
                <span className="rounded-md bg-muted px-2 py-1 text-muted-foreground">
                  {t(`orchestrator.formats.${result.outputFormat}`)}
                </span>
              )}
              <span className="rounded-md bg-muted px-2 py-1 text-muted-foreground">
                {t(`orchestrator.tokenMethods.${result.tokenMetrics.method}`)}
              </span>
              <span className="rounded-md bg-muted px-2 py-1 text-muted-foreground">
                {t("orchestrator.completeTokens")}: {result.tokenMetrics.completePromptTokens}
              </span>
            </div>
            {result.status === "degraded" && (
              <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-700 dark:text-yellow-300">
                {t("orchestrator.degraded")}
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/30 px-3 py-2">
              <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={favorite}
                  onChange={(event) => setFavorite(event.target.checked)}
                  disabled={Boolean(savedPromptId)}
                />
                <span>{t("orchestrator.saveWithFavorite")}</span>
              </label>
              <Button
                size="sm"
                variant={savedPromptId ? "ghost" : "secondary"}
                disabled={Boolean(savedPromptId) || isSavingToLibrary}
                onClick={() => onSaveToLibrary(favorite)}
                data-testid="orchestrator-save-to-library"
              >
                {savedPromptId
                  ? t("orchestrator.savedToPromptLibrary")
                  : isSavingToLibrary
                    ? t("orchestrator.savingToPromptLibrary")
                    : t("orchestrator.saveToPromptLibrary")}
              </Button>
            </div>
            {result.layout ? (
              <PromptMossLayoutResultView result={result} />
            ) : (
              <PromptComparisonView
                source={sourcePrompt}
                generated={result.completePrompt}
                alignment={result.alignment}
              />
            )}
            {result.payload !== undefined && (
              <section className="space-y-2">
                <h4 className="text-xs font-semibold text-muted-foreground">
                  {t("orchestrator.payload")}
                </h4>
                <Textarea
                  value={JSON.stringify(result.payload, null, 2)}
                  readOnly
                  rows={8}
                  className="bg-muted/30 font-mono text-[11px]"
                />
              </section>
            )}
          </div>
        ) : tab === "decisions" ? (
          result.termDecisions ? (
            <PromptTermDecisionPanel
              decisions={result.termDecisions}
              summary={result.retrievalSummary}
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              {t("orchestrator.dynamicPolish.empty")}
            </p>
          )
        ) : tab === "initial" ? (
          <div className="space-y-2">
            <Textarea
              value={result.initialPrompt}
              readOnly
              rows={18}
              className="bg-muted/30"
            />
            <p className="text-[11px] text-muted-foreground">
              {t("orchestrator.initialTokens")}: {result.tokenMetrics.initialPromptTokens}
            </p>
          </div>
        ) : tab === "fields" ? (
          <div className="space-y-5">
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[640px] text-left text-xs">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">{t("orchestrator.name")}</th>
                    <th className="px-3 py-2">{t("orchestrator.value")}</th>
                    <th className="px-3 py-2">{t("orchestrator.layer")}</th>
                    <th className="px-3 py-2">{t("orchestrator.rationale")}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.fields.map((field, index) => (
                    <FieldRow
                      key={`${field.name}-${field.termId ?? "llm"}-${index}`}
                      field={field}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            {result.selectedTerms.length > 0 && (
              <section className="space-y-2">
                <h4 className="text-xs font-semibold">{t("orchestrator.selectedTerms")}</h4>
                <div className="flex flex-wrap gap-1.5">
                  {result.selectedTerms.map((term) => (
                    <span key={term.id} className="rounded bg-muted px-2 py-1 text-[11px]">
                      {term.template ?? term.en}
                    </span>
                  ))}
                </div>
              </section>
            )}
            {result.warnings.length > 0 && (
              <section className="space-y-2 rounded-md border border-border p-3">
                <h4 className="text-xs font-semibold">{t("orchestrator.warnings")}</h4>
                <ul className="list-disc space-y-1 pl-4 text-[11px] text-muted-foreground">
                  {result.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </section>
            )}
            <p className="text-[11px] text-muted-foreground">
              {t("orchestrator.vocabularyTokens")}: ≈{result.tokenMetrics.vocabularyEstimatedTokens}
            </p>
          </div>
        ) : skillDraft ? (
          <PromptSkillDraftPanel
            draft={skillDraft}
            savedSkillId={savedSkillId}
            isSaving={isSavingSkill}
            onSave={onSaveSkill}
          />
        ) : (
          <p className="text-xs text-muted-foreground">{t("orchestrator.skillDraftEmpty")}</p>
        )}
      </div>
    </aside>
  );
}
