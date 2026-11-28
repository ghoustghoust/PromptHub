import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  SCRIPT_STAGE_ORDER,
  type PromptScriptFlow,
  type PromptScriptStage,
  type PromptUnitMaterialMode,
} from "@prompthub/core/prompt-script-flow";
import { resolveLocalImageSrc } from "../../utils/media-url";
import { canSaveStage, scriptStageStatus } from "./script-flow-view";
import type { ScriptFlowState } from "./useScriptFlow";

const STATUS_STYLE: Record<string, string> = {
  done: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  next: "border-primary/40 bg-primary/10 text-primary",
  stale: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  empty: "border-border/60 bg-muted/20 text-muted-foreground",
};

const MATERIAL_MODES: PromptUnitMaterialMode[] = [
  "text",
  "first-frame",
  "first-last",
  "references",
];

interface ScriptFlowPanelProps {
  state: ScriptFlowState;
  disabled?: boolean;
}

/** Linear script steps: pick a stage, save a version, reuse an earlier one. */
export function ScriptFlowPanel({ state, disabled }: ScriptFlowPanelProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const flow: PromptScriptFlow = state.flow ?? { versions: { outline: [], script: [], storyboard: [], unit: [] } };
  const canSave = !disabled && !state.saving && canSaveStage(flow, state.stage);

  return (
    <div
      className="space-y-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2"
      data-testid="orchestrator-script-flow"
    >
      <button
        type="button"
        className="flex w-full items-center justify-between text-left text-xs font-medium"
        onClick={() => setOpen((current) => !current)}
        data-testid="orchestrator-script-flow-toggle"
      >
        <span>{t("orchestrator.scriptFlow.title")}</span>
        <span className="text-[11px] font-normal text-muted-foreground">
          {t(`orchestrator.scriptFlow.stages.${state.stage}`)}
        </span>
      </button>
      {open && (
        <>
          <p className="text-[11px] text-muted-foreground">
            {t("orchestrator.scriptFlow.hint")}
          </p>
          <div className="flex flex-wrap gap-1">
            {SCRIPT_STAGE_ORDER.map((stage) => {
              const status = scriptStageStatus(flow, stage);
              return (
                <button
                  key={stage}
                  type="button"
                  className={`rounded-md border px-2 py-1 text-[11px] ${
                    stage === state.stage ? "ring-1 ring-primary" : ""
                  } ${STATUS_STYLE[status]}`}
                  onClick={() => state.setStage(stage)}
                  disabled={disabled}
                  data-testid={`orchestrator-script-stage-${stage}`}
                  data-status={status}
                >
                  {t(`orchestrator.scriptFlow.stages.${stage}`)}
                </button>
              );
            })}
          </div>
          <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>{t("orchestrator.scriptFlow.shotCount")}</span>
            <input
              type="number"
              min={1}
              max={60}
              className="h-7 w-16 rounded-md border border-border bg-background px-2 text-xs"
              value={state.shotCount}
              onChange={(event) => {
                const next = Number.parseInt(event.target.value, 10);
                state.setShotCount(Number.isFinite(next) ? Math.min(60, Math.max(1, next)) : 1);
              }}
              disabled={disabled}
              data-testid="orchestrator-script-shot-count"
            />
          </label>
          {state.stage === "unit" && (
            <div
              className="space-y-1 rounded-md border border-border/60 bg-background/40 px-2 py-2"
              data-testid="orchestrator-unit-materials"
            >
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-[11px] text-muted-foreground">
                  {t("orchestrator.scriptFlow.materials.mode")}
                </span>
                {MATERIAL_MODES.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={`rounded-md border px-2 py-1 text-[11px] ${
                      state.materials.mode === mode
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-border/60 bg-muted/20 text-muted-foreground"
                    }`}
                    onClick={() => state.setMaterialMode(mode)}
                    disabled={disabled}
                    data-testid={`orchestrator-unit-material-mode-${mode}`}
                    data-active={state.materials.mode === mode}
                  >
                    {t(`orchestrator.scriptFlow.materials.modes.${mode}`)}
                  </button>
                ))}
              </div>
              {state.materials.mode === "references" && (
                <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span>{t("orchestrator.scriptFlow.materials.referenceCount")}</span>
                  <input
                    type="number"
                    min={1}
                    max={9}
                    className="h-7 w-16 rounded-md border border-border bg-background px-2 text-xs"
                    value={state.materials.referenceCount ?? state.materials.slots.length}
                    onChange={(event) => {
                      const next = Number.parseInt(event.target.value, 10);
                      state.setReferenceCount(Number.isFinite(next) ? next : 1);
                    }}
                    disabled={disabled}
                    data-testid="orchestrator-unit-material-reference-count"
                  />
                </label>
              )}
              {state.materials.slots.length > 0 && (
                <ul className="space-y-1">
                  {state.materials.slots.map((slot) => {
                    const key = `${slot.kind}-${slot.index ?? 0}`;
                    return (
                      <li key={key} className="flex items-center gap-2 text-[11px]">
                        {slot.fileName ? (
                          <img
                            src={resolveLocalImageSrc(slot.fileName)}
                            alt={slot.label ?? ""}
                            className="h-8 w-8 shrink-0 rounded border border-border/60 object-cover"
                          />
                        ) : (
                          <span className="h-8 w-8 shrink-0 rounded border border-dashed border-border/60" />
                        )}
                        <span className="min-w-0 flex-1 truncate">
                          {t(`orchestrator.scriptFlow.materials.slots.${slot.kind}`, {
                            index: slot.index ?? 1,
                          })}
                        </span>
                        <span
                          className={`shrink-0 ${
                            slot.fileName ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"
                          }`}
                          data-testid={`orchestrator-unit-material-status-${key}`}
                          data-status={slot.fileName ? "provided" : "missing"}
                        >
                          {slot.fileName
                            ? t("orchestrator.scriptFlow.materials.provided")
                            : t("orchestrator.scriptFlow.materials.missing")}
                        </span>
                        <button
                          type="button"
                          className="shrink-0 underline-offset-2 hover:underline"
                          onClick={() => void state.fillMaterialSlot(slot.kind, slot.index)}
                          disabled={disabled}
                          data-testid={`orchestrator-unit-material-fill-${key}`}
                        >
                          {t("orchestrator.scriptFlow.materials.fill")}
                        </button>
                        {slot.fileName && (
                          <button
                            type="button"
                            className="shrink-0 underline-offset-2 hover:underline"
                            onClick={() => state.clearMaterialSlot(slot.kind, slot.index)}
                            disabled={disabled}
                            data-testid={`orchestrator-unit-material-clear-${key}`}
                          >
                            {t("orchestrator.scriptFlow.materials.clear")}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="text-[11px] text-muted-foreground" data-testid="orchestrator-unit-material-note">
                {t("orchestrator.scriptFlow.materials.note", {
                  count: state.missingMaterialCount,
                })}
              </p>
            </div>
          )}
          <textarea
            className="min-h-[72px] w-full rounded-md border border-border bg-background px-2 py-1 text-xs"
            value={state.draft}
            placeholder={t("orchestrator.scriptFlow.draftPlaceholder")}
            onChange={(event) => state.setDraft(event.target.value)}
            disabled={disabled}
            data-testid="orchestrator-script-draft"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-md border border-border px-2 py-1 text-[11px] disabled:opacity-50"
              onClick={() => void state.saveVersion()}
              disabled={!canSave || !state.draft.trim()}
              data-testid="orchestrator-script-save"
            >
              {state.saving
                ? t("orchestrator.scriptFlow.saving")
                : t("orchestrator.scriptFlow.save")}
            </button>
            <span className="text-[11px] text-muted-foreground">
              {t("orchestrator.scriptFlow.versions", { count: state.versions.length })}
            </span>
          </div>
          {state.error && (
            <p className="text-[11px] text-destructive" data-testid="orchestrator-script-error">
              {state.error}
            </p>
          )}
          {state.versions.length > 0 && (
            <ul className="space-y-1">
              {state.versions.slice(0, 10).map((item) => (
                <li key={item.version} className="flex items-center gap-2 text-[11px]">
                  <span className="shrink-0 text-muted-foreground">v{item.version}</span>
                  <span className="min-w-0 flex-1 truncate">{item.text}</span>
                  <button
                    type="button"
                    className="shrink-0 underline-offset-2 hover:underline"
                    onClick={() => state.loadVersion(item.text)}
                    disabled={disabled}
                    data-testid={`orchestrator-script-load-${item.version}`}
                  >
                    {t("orchestrator.scriptFlow.useInStep")}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}