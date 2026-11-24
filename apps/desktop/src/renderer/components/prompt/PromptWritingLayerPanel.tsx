import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  PromptWritingLayerBudgetPreview,
  PromptWritingPreset,
  PromptWritingPresetSummary,
} from "@prompthub/shared/types";
import { estimatePromptTokens } from "@prompthub/shared/utils/prompt-token-estimate";
import { Select } from "../ui/Select";
import { Textarea } from "../ui/Textarea";
import {
  EMPTY_WRITING_LAYER,
  assemblePresetLayerText,
  normalizeSectionIds,
  writingLayerSections,
  type WritingLayerSelection,
} from "./prompt-writing-layer";

const CONTEXT_OPTIONS = [
  { value: "8192", label: "8K" },
  { value: "32768", label: "32K" },
  { value: "65536", label: "64K" },
];

interface Props {
  selection: WritingLayerSelection;
  text: string;
  source: string | null;
  disabled?: boolean;
  contextTokens: number;
  contextLocked: boolean;
  budget: PromptWritingLayerBudgetPreview | null;
  budgetError: string;
  onSelectionChange: (next: WritingLayerSelection) => void;
  onTextChange: (text: string, source: string | null) => void;
  onContextTokensChange: (value: number) => void;
}

/**
 * Picks and previews the writing layer. Everything here is text the user chose
 * to inject; the panel never shortens it silently and shows the same budget the
 * orchestrator will enforce.
 */
export function PromptWritingLayerPanel({
  selection,
  text,
  source,
  disabled = false,
  contextTokens,
  contextLocked,
  budget,
  budgetError,
  onSelectionChange,
  onTextChange,
  onContextTokensChange,
}: Props) {
  const { t } = useTranslation();
  const [summaries, setSummaries] = useState<PromptWritingPresetSummary[]>([]);
  const [preset, setPreset] = useState<PromptWritingPreset | null>(null);
  const [open, setOpen] = useState(true);
  const [error, setError] = useState("");

  const api = window.api.promptWritingPresets;

  useEffect(() => {
    let active = true;
    if (!api) return () => {
      active = false;
    };
    void api.list().then((reply) => {
      if (!active) return;
      if (reply.ok === true) setSummaries(reply.data);
      else setError(reply.error.message);
    });
    return () => {
      active = false;
    };
  }, [api]);

  useEffect(() => {
    let active = true;
    if (!api || !selection.presetId) {
      setPreset(null);
      return () => {
        active = false;
      };
    }
    void api.get(selection.presetId).then((reply) => {
      if (!active) return;
      if (reply.ok !== true) {
        setError(reply.error.message);
        setPreset(null);
        return;
      }
      setPreset(reply.data);
    });
    return () => {
      active = false;
    };
  }, [api, selection.presetId]);

  const availableSections = useMemo(
    () => writingLayerSections(preset, selection.variant),
    [preset, selection.variant],
  );

  const selectedSections = useMemo(
    () => availableSections.filter((section) => selection.sectionIds.includes(section.id)),
    [availableSections, selection.sectionIds],
  );

  const assembled = useMemo(() => {
    if (selection.mode !== "preset" || !preset) return "";
    return assemblePresetLayerText(preset, selection.variant, selection.sectionIds);
  }, [preset, selection.mode, selection.sectionIds, selection.variant]);

  // Section ids come from the document text; after a preset or variant change
  // the stored ids may not exist, so they are normalized once. An explicit
  // "select none" is preserved instead of being normalized back to everything.
  const lastSelectionKey = useRef("");
  useEffect(() => {
    if (selection.mode !== "preset" || !preset) return;
    const key = `${preset.id}:${selection.variant}`;
    const fresh = lastSelectionKey.current !== key;
    lastSelectionKey.current = key;
    const ids = fresh
      ? normalizeSectionIds(preset, selection.variant, selection.sectionIds)
      : selection.sectionIds;
    if (
      fresh &&
      (ids.length !== selection.sectionIds.length ||
        ids.some((id, index) => id !== selection.sectionIds[index]))
    ) {
      onSelectionChange({ ...selection, sectionIds: ids });
    }
    const nextText = assemblePresetLayerText(preset, selection.variant, ids);
    if (nextText !== text) {
      onTextChange(nextText, preset.name);
    }
  }, [preset, selection, text, onSelectionChange, onTextChange]);

  const applySelection = useCallback(
    (next: WritingLayerSelection) => {
      onSelectionChange(next);
    },
    [onSelectionChange],
  );

  const toggleSection = (id: string) => {
    const ids = selection.sectionIds.includes(id)
      ? selection.sectionIds.filter((item) => item !== id)
      : [...selection.sectionIds, id];
    applySelection({ ...selection, sectionIds: ids });
  };

  const usedTokens = estimatePromptTokens(text);
  const budgetTokens = budget?.budgetTokens ?? null;
  const overBudget = budgetTokens !== null && usedTokens > budgetTokens;
  const percent = budgetTokens && budgetTokens > 0
    ? Math.min(100, Math.round((usedTokens / budgetTokens) * 100))
    : 0;

  const activePreset = selection.presetId
    ? summaries.find((item) => item.id === selection.presetId) ?? null
    : null;

  return (
    <div className="space-y-2 rounded-lg border border-border/70 p-3" data-testid="orchestrator-writing-layer">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-xs font-medium">{t("orchestrator.writingLayer.title")}</span>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          {source && <span className="max-w-[16rem] truncate" title={source}>{source}</span>}
          <span data-testid="writing-layer-tokens">
            {t("orchestrator.writingLayer.meter", { used: usedTokens, budget: budgetTokens ?? "?" })}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-1 rounded-md border border-border bg-muted/30 p-1" role="group">
        {(["preset", "custom"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={selection.mode === value}
            onClick={() => {
              setOpen(value === "preset");
              if (value === "custom") {
                onSelectionChange({ ...EMPTY_WRITING_LAYER });
                onTextChange("", null);
              } else {
                onSelectionChange({ mode: "preset", presetId: null, variant: "compressed", sectionIds: [] });
                onTextChange("", null);
              }
            }}
            disabled={disabled}
            className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
              selection.mode === value
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            data-testid={`writing-layer-mode-${value}`}
          >
            {t(`orchestrator.writingLayer.modes.${value}`)}
          </button>
        ))}
      </div>

      <div
        className={`h-1.5 overflow-hidden rounded-full ${overBudget ? "bg-destructive/20" : "bg-muted"}`}
        role="progressbar"
        aria-valuenow={usedTokens}
        aria-valuemax={budgetTokens ?? undefined}
      >
        <div
          className={`h-full transition-all ${overBudget ? "bg-destructive" : percent > 85 ? "bg-amber-500" : "bg-primary"}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span data-testid="writing-layer-breakdown">
          {budget
            ? t("orchestrator.writingLayer.breakdown", {
                context: budget.contextTokens,
                output: budget.outputReserveTokens,
                contract: budget.contractTokens,
                vocabulary: budget.vocabularyTokens,
              })
            : t("orchestrator.writingLayer.budgetPending")}
        </span>
        <label className="flex items-center gap-1.5">
          <span>{t("orchestrator.writingLayer.context")}</span>
          <Select
            value={String(contextTokens)}
            options={CONTEXT_OPTIONS}
            onChange={(value) => onContextTokensChange(Number(value))}
            disabled={contextLocked || disabled}
            presentation="compact"
            ariaLabel={t("orchestrator.writingLayer.context")}
          />
        </label>
      </div>
      {contextLocked && (
        <p className="text-[11px] text-muted-foreground">{t("orchestrator.writingLayer.contextLocked")}</p>
      )}
      {overBudget && (
        <p className="text-xs text-destructive" data-testid="writing-layer-over-budget">
          {t("orchestrator.writingLayer.overBudget", {
            over: usedTokens - (budgetTokens ?? 0),
          })}
        </p>
      )}
      {budgetError && <p className="text-xs text-destructive">{budgetError}</p>}

      {selection.mode === "preset" ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-0 flex-1 space-y-1 text-xs font-medium">
              <span>{t("orchestrator.writingLayer.preset")}</span>
              <Select
                value={selection.presetId ?? ""}
                options={[
                  { value: "", label: t("orchestrator.writingLayer.pickPreset") },
                  ...summaries.map((item) => ({ value: item.id, label: item.name })),
                ]}
                onChange={(value) =>
                  applySelection({
                    mode: "preset",
                    presetId: value || null,
                    variant: "compressed",
                    sectionIds: [],
                  })
                }
                disabled={disabled}
                presentation="form"
                ariaLabel={t("orchestrator.writingLayer.preset")}
              />
            </label>
            <button
              type="button"
              className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
              onClick={() => setOpen((value) => !value)}
              data-testid="writing-layer-toggle-sections"
            >
              {open ? t("orchestrator.writingLayer.hideSections") : t("orchestrator.writingLayer.showSections")}
            </button>
          </div>

          {activePreset && (
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <span>{t(`orchestrator.writingLayer.targets.${activePreset.targetSkill}`)}</span>
              <span>·</span>
              <span>{t(`orchestrator.writingLayer.methodologies.${activePreset.methodology}`)}</span>
              <span>·</span>
              <span>{t(`orchestrator.writingLayer.validation.${activePreset.validationStatus}`)}</span>
            </div>
          )}

          {preset?.originalContent && (
            <div className="flex items-center gap-1 rounded-md border border-border bg-muted/30 p-1" role="group">
              {(["compressed", "original"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={selection.variant === value}
                  onClick={() => applySelection({ ...selection, variant: value, sectionIds: [] })}
                  disabled={disabled}
                  className={`rounded px-2 py-1 text-[11px] font-medium transition-colors ${
                    selection.variant === value
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  data-testid={`writing-layer-variant-${value}`}
                >
                  {t(`orchestrator.writingLayer.variants.${value}`)}
                </button>
              ))}
            </div>
          )}

          {open && availableSections.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>{t("orchestrator.writingLayer.sectionCount", { count: selectedSections.length, total: availableSections.length })}</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="underline-offset-2 hover:underline"
                    onClick={() => applySelection({ ...selection, sectionIds: availableSections.map((section) => section.id) })}
                    disabled={disabled}
                  >
                    {t("orchestrator.writingLayer.selectAll")}
                  </button>
                  <button
                    type="button"
                    className="underline-offset-2 hover:underline"
                    onClick={() => applySelection({ ...selection, sectionIds: [] })}
                    disabled={disabled}
                  >
                    {t("orchestrator.writingLayer.selectNone")}
                  </button>
                </div>
              </div>
              <div className="max-h-40 overflow-y-auto rounded-md border border-border/70" data-testid="writing-layer-sections">
                {availableSections.map((section) => (
                  <label
                    key={section.id}
                    className="flex cursor-pointer items-start gap-2 border-b border-border/40 px-2 py-1.5 text-[11px] last:border-0 hover:bg-muted/30"
                  >
                    <input
                      type="checkbox"
                      checked={selection.sectionIds.includes(section.id)}
                      onChange={() => toggleSection(section.id)}
                      disabled={disabled}
                      className="mt-0.5"
                      data-testid={`writing-layer-section-${section.id}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium" title={section.title}>{section.title}</span>
                      <span className="text-muted-foreground">
                        {t("orchestrator.writingLayer.sectionTokens", {
                          chars: section.charCount,
                          tokens: section.tokenEstimate,
                        })}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {preset && (
            <div>
              <p className="mb-1 text-[11px] text-muted-foreground">{t("orchestrator.writingLayer.preview")}</p>
              <pre
                className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border/70 bg-muted/20 p-2 text-[11px] leading-relaxed"
                data-testid="writing-layer-preview"
              >
                {assembled || t("orchestrator.writingLayer.emptyPreview")}
              </pre>
            </div>
          )}
          {!selection.presetId && (
            <p className="text-[11px] text-muted-foreground">{t("orchestrator.writingLayer.pickHint")}</p>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      ) : (
        <div className="space-y-1">
          <Textarea
            value={text}
            onChange={(event) => onTextChange(event.target.value, null)}
            placeholder={t("orchestrator.writingLayer.customPlaceholder")}
            rows={5}
            disabled={disabled}
            data-testid="writing-layer-custom"
          />
          <p className="text-[11px] text-muted-foreground">{t("orchestrator.writingLayer.customHint")}</p>
        </div>
      )}
    </div>
  );
}
