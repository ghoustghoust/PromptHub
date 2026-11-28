import { useState } from "react";
import { useTranslation } from "react-i18next";

interface StepContextPanelProps {
  value: string;
  onChange: (text: string) => void;
  disabled?: boolean;
}

/** Upstream material for this run: outline text, a scene, or a previous stage. */
export function StepContextPanel({ value, onChange, disabled }: StepContextPanelProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <div
      className="space-y-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2"
      data-testid="orchestrator-step-context"
    >
      <button
        type="button"
        className="flex w-full items-center justify-between text-left text-xs font-medium"
        onClick={() => setOpen((current) => !current)}
        data-testid="orchestrator-step-context-toggle"
      >
        <span>{t("orchestrator.stepContext.title")}</span>
        <span className="text-[11px] font-normal text-muted-foreground">
          {t("orchestrator.stepContext.count", { count: value.trim().length })}
        </span>
      </button>
      {open && (
        <>
          <p className="text-[11px] text-muted-foreground">
            {t("orchestrator.stepContext.hint")}
          </p>
          <textarea
            className="min-h-[72px] w-full rounded-md border border-border bg-background px-2 py-1 text-xs"
            value={value}
            placeholder={t("orchestrator.stepContext.placeholder")}
            onChange={(event) => onChange(event.target.value)}
            disabled={disabled}
            data-testid="orchestrator-step-context-input"
          />
          {value.trim().length > 0 && (
            <button
              type="button"
              className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
              onClick={() => onChange("")}
              disabled={disabled}
              data-testid="orchestrator-step-context-clear"
            >
              {t("orchestrator.stepContext.clear")}
            </button>
          )}
        </>
      )}
    </div>
  );
}