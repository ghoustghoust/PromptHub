import { CheckIcon, SaveIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PromptSkillDraft } from "@prompthub/shared/types";
import { Button } from "../ui/Button";
import { Textarea } from "../ui/Textarea";

interface PromptSkillDraftPanelProps {
  draft: PromptSkillDraft;
  savedSkillId: string | null;
  isSaving: boolean;
  onSave: () => void;
}

export function PromptSkillDraftPanel({
  draft,
  savedSkillId,
  isSaving,
  onSave,
}: PromptSkillDraftPanelProps) {
  const { t } = useTranslation();
  return (
    <section className="space-y-4 rounded-lg border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{t("orchestrator.skillDraft")}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{draft.description}</p>
        </div>
        <span className="rounded bg-muted px-2 py-1 text-xs font-medium">{draft.name}</span>
      </div>
      {draft.status === "degraded" && (
        <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-700 dark:text-yellow-300">
          {t("orchestrator.degraded")}
        </div>
      )}
      <Textarea value={draft.content} readOnly rows={16} className="bg-muted/30 font-mono text-xs" />
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{t("orchestrator.referenceContent")}</h3>
        <div className="space-y-2">
          {draft.references.map((item) => (
            <details key={`${item.kind}-${item.id}`} className="rounded-md bg-muted/40 px-3 py-2 text-xs">
              <summary className="cursor-pointer font-medium">
                [REFERENCE] {item.label}
                {item.validationStatus ? ` · ${item.validationStatus}` : ""}
              </summary>
              <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{item.content}</p>
            </details>
          ))}
        </div>
      </section>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{t("orchestrator.creativeSuggestions")}</h3>
        {draft.suggestions.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("orchestrator.noSkillSuggestions")}</p>
        ) : (
          <ul className="space-y-2 text-xs">
            {draft.suggestions.map((suggestion) => (
              <li key={`${suggestion.title}-${suggestion.content}`} className="rounded-md bg-muted/40 px-3 py-2">
                <div className="font-medium">[SUGGESTION] {suggestion.title}</div>
                <p className="mt-1 whitespace-pre-wrap">{suggestion.content}</p>
                {suggestion.rationale && (
                  <p className="mt-1 text-muted-foreground">{suggestion.rationale}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      {draft.warnings.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          {draft.warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      )}
      <Button
        className="w-full"
        disabled={isSaving || Boolean(savedSkillId)}
        onClick={onSave}
      >
        {savedSkillId ? (
          <CheckIcon className="h-4 w-4" aria-hidden="true" />
        ) : (
          <SaveIcon className="h-4 w-4" aria-hidden="true" />
        )}
        {savedSkillId
          ? t("orchestrator.savedToLibrary")
          : isSaving
            ? t("orchestrator.savingToLibrary")
            : t("orchestrator.saveToLibrary")}
      </Button>
    </section>
  );
}
