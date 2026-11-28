import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { PromptSharedSemantics } from "@prompthub/shared/types";

type FactField = keyof Omit<PromptSharedSemantics, "constraints">;

const FACT_FIELDS: Array<{ key: FactField; label: string }> = [
  { key: "subject", label: "orchestrator.sharedFacts.subject" },
  { key: "action", label: "orchestrator.sharedFacts.action" },
  { key: "setting", label: "orchestrator.sharedFacts.setting" },
  { key: "composition", label: "orchestrator.sharedFacts.composition" },
  { key: "lighting", label: "orchestrator.sharedFacts.lighting" },
  { key: "palette", label: "orchestrator.sharedFacts.palette" },
  { key: "continuity", label: "orchestrator.sharedFacts.continuity" },
];

interface SharedFactsPanelProps {
  value: PromptSharedSemantics;
  onChange: (next: PromptSharedSemantics) => void;
  disabled?: boolean;
}

/** Upstream facts shared by every target model; persisted with the workspace. */
export function SharedFactsPanel({ value, onChange, disabled }: SharedFactsPanelProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const filled = countFilled(value);

  const updateField = (key: FactField, text: string) => {
    const next = { ...value };
    if (text.trim()) next[key] = text;
    else delete next[key];
    onChange(next);
  };

  const updateConstraints = (text: string) => {
    const next = { ...value };
    const items = text
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    if (items.length > 0) next.constraints = items;
    else delete next.constraints;
    onChange(next);
  };

  return (
    <div
      className="space-y-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2"
      data-testid="orchestrator-shared-facts"
    >
      <button
        type="button"
        className="flex w-full items-center justify-between text-left text-xs font-medium"
        onClick={() => setOpen((current) => !current)}
        data-testid="orchestrator-shared-facts-toggle"
      >
        <span>{t("orchestrator.sharedFacts.title")}</span>
        <span className="text-[11px] font-normal text-muted-foreground">
          {t("orchestrator.sharedFacts.count", { count: filled })}
        </span>
      </button>
      {open && (
        <>
          <p className="text-[11px] text-muted-foreground">
            {t("orchestrator.sharedFacts.hint")}
          </p>
          {FACT_FIELDS.map((field) => (
            <label key={field.key} className="block space-y-1">
              <span className="text-[11px] text-muted-foreground">{t(field.label)}</span>
              <input
                type="text"
                className="h-7 w-full rounded-md border border-border bg-background px-2 text-xs"
                value={value[field.key] ?? ""}
                onChange={(event) => updateField(field.key, event.target.value)}
                disabled={disabled}
                data-testid={`orchestrator-shared-${field.key}`}
              />
            </label>
          ))}
          <label className="block space-y-1">
            <span className="text-[11px] text-muted-foreground">
              {t("orchestrator.sharedFacts.constraints")}
            </span>
            <input
              type="text"
              className="h-7 w-full rounded-md border border-border bg-background px-2 text-xs"
              value={(value.constraints ?? []).join(", ")}
              onChange={(event) => updateConstraints(event.target.value)}
              disabled={disabled}
              data-testid="orchestrator-shared-constraints"
            />
          </label>
        </>
      )}
    </div>
  );
}

function countFilled(value: PromptSharedSemantics): number {
  const scalars = [
    value.subject,
    value.action,
    value.setting,
    value.composition,
    value.lighting,
    value.palette,
    value.continuity,
  ].filter((item) => item && item.trim().length > 0).length;
  return scalars + (value.constraints?.length ? 1 : 0);
}