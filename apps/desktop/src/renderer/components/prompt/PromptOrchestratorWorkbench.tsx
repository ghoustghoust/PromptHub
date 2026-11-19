import { useState } from "react";
import {
  FilePlus2Icon,
  LoaderCircleIcon,
  PlayIcon,
  Settings2Icon,
  SparklesIcon,
  SquareIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { supportsReferenceImages } from "@prompthub/shared/types";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Select } from "../ui/Select";
import { Textarea } from "../ui/Textarea";
import { useToast } from "../ui/Toast";
import { usePromptOrchestratorWorkbench } from "./usePromptOrchestratorWorkbench";
import { PromptOrchestratorResultPanel } from "./PromptOrchestratorResultPanel";
import { useLocalLlamaEngine } from "../settings/useLocalLlamaEngine";
import { LOCAL_LLAMA_MODEL_ID } from "../../stores/settings/settings-ai-actions";
import { useUIStore } from "../../stores/ui.store";
import { PromptReferenceImageInput } from "./PromptReferenceImageInput";
import { PromptVideoFields } from "./PromptVideoFields";
import { PromptVocabularyPrefabPanel } from "./PromptVocabularyPrefabPanel";
import { PromptMossLayoutCanvas } from "./PromptMossLayoutCanvas";
import {
  taskModesForSkill,
  isVideoTask,
  outputFormatOptions,
} from "./prompt-orchestrator-catalog";

type WorkbenchState = ReturnType<typeof usePromptOrchestratorWorkbench>;
type SelectValue = { value: string; label: string };

function SelectControl({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  options: SelectValue[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="block space-y-1.5 text-sm font-medium text-foreground">
      <span>{label}</span>
      <Select
        value={value}
        options={options}
        onChange={onChange}
        disabled={disabled}
        presentation="form"
        ariaLabel={label}
      />
    </label>
  );
}

function LocalEngineQuickControl({ onConnected }: { onConnected: () => void }) {
  const { t } = useTranslation();
  const engine = useLocalLlamaEngine();
  const requestSettingsSection = useUIStore(
    (state) => state.requestSettingsSection,
  );
  const running = engine.status?.phase === "running";
  const start = async () => {
    if (await engine.start()) onConnected();
  };
  return (
    <div className="space-y-2 rounded-lg border border-border/70 bg-muted/20 p-3" data-testid="orchestrator-local-engine">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-xs">
          <span className={`h-2 w-2 shrink-0 rounded-full ${running ? "bg-emerald-500" : "bg-muted-foreground"}`} />
          <span className="truncate">
            {t("localModel.menu")} · {engine.status ? t(`localModel.phase.${engine.status.phase}`) : t("localModel.checking")}
          </span>
        </div>
        <div className="flex shrink-0 gap-1">
          {!running && (
            <Button size="sm" variant="secondary" onClick={() => void start()} disabled={engine.busy} data-testid="orchestrator-engine-start">
              <PlayIcon className="h-3.5 w-3.5" />{t("localModel.start")}
            </Button>
          )}
          {running && engine.status?.managed && (
            <Button size="sm" variant="ghost" onClick={() => void engine.stop()} disabled={engine.busy}>
              <SquareIcon className="h-3.5 w-3.5" />{t("localModel.stop")}
            </Button>
          )}
          <Button size="sm" variant="ghost" aria-label={t("localModel.menu")} onClick={() => requestSettingsSection("localModel")}>
            <Settings2Icon className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      {engine.error && <p className="text-xs text-destructive">{engine.error}</p>}
    </div>
  );
}

export function PromptOrchestratorWorkbench() {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const state = usePromptOrchestratorWorkbench();
  const [resultExpanded, setResultExpanded] = useState(false);
  const modeOptions = taskModesForSkill(state.skill).map((value) => ({
    value,
    label: t(`orchestrator.modes.${value}`),
  }));
  const videoTask = isVideoTask(state.mode);
  const humanLed = state.guidanceMode === "human-led" && !videoTask;
  const mossLayoutMode = state.skill === "moss" && state.outputFormat === "layout";
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      showToast(t("orchestrator.copied"));
    } catch {
      showToast(t("orchestrator.copyFailed"), "error");
    }
  };
  const saveSkill = async () => {
    const id = await state.saveSkill();
    if (id) showToast(t("orchestrator.skillCreated"));
    else showToast(t("orchestrator.skillSaveFailed"), "error");
  };
  const saveToLibrary = async (favorite: boolean) => {
    const id = await state.saveResultToLibrary(favorite);
    if (id) showToast(t("orchestrator.savedToPromptLibrary"));
  };
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="shrink-0 border-b border-border px-6 py-3">
        <h1 className="text-base font-semibold">{t("orchestrator.title")}</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t("orchestrator.subtitle")}
        </p>
      </header>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div
          className={`shrink-0 space-y-4 overflow-y-auto border-b border-border p-4 lg:w-[320px] lg:border-b-0 lg:border-r ${
            resultExpanded ? "hidden" : "block"
          }`}
        >
          <SelectControl
            label={t("orchestrator.skill")}
            value={state.skill}
            options={[
              { value: "moodyMoss", label: "moodyMoss" },
              { value: "moss", label: "MOSS" },
              { value: "k2", label: "Krea 2 / K2" },
              { value: "minimaxH3", label: "MiniMax-H3 Video" },
            ]}
            onChange={(value) => state.setSkill(value as WorkbenchState["skill"])}
          />
          <SelectControl
            label={t("orchestrator.mode")}
            value={state.mode}
            options={modeOptions}
            onChange={(value) => state.setMode(value as WorkbenchState["mode"])}
          />
          <div className="space-y-1 rounded-lg border border-primary/20 bg-primary/5 p-3" data-testid="orchestrator-mode-guide">
            <p className="text-xs font-medium text-primary">{t(`orchestrator.modeDetails.${state.mode}`)}</p>
            <p className="text-xs text-muted-foreground">{t(`orchestrator.modeInputs.${state.mode}`)}</p>
          </div>
          {!videoTask && (
            <div className="space-y-1">
              <SelectControl
                label={t("orchestrator.guidanceMode")}
                value={state.guidanceMode}
                options={[
                  { value: "agent-led", label: t("orchestrator.guidance.agent-led") },
                  { value: "human-led", label: t("orchestrator.guidance.human-led") },
                ]}
                onChange={(value) => state.setGuidanceMode(value as WorkbenchState["guidanceMode"])}
              />
              <p className="text-[11px] text-muted-foreground">
                {t(`orchestrator.guidanceHint.${state.guidanceMode}`)}
              </p>
            </div>
          )}
          {!videoTask && (
            <div className="space-y-2 rounded-lg border border-border/70 p-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-medium">{t("orchestrator.systemLayer")}</span>
                {state.systemLayerSource && (
                  <span className="truncate text-[11px] text-muted-foreground">
                    {t("orchestrator.systemLayerSource", { title: state.systemLayerSource })}
                  </span>
                )}
              </div>
              <Select
                value=""
                options={[
                  { value: "", label: t("orchestrator.systemLayerFromLibrary") },
                  ...state.libraryPrompts.slice(0, 100).map((item) => ({
                    value: item.id,
                    label: item.title,
                  })),
                ]}
                onChange={(value) => void state.applyLibraryPrompt(value)}
                presentation="form"
                ariaLabel={t("orchestrator.systemLayerFromLibrary")}
              />
              <Textarea
                value={state.systemLayer}
                onChange={(event) => state.updateSystemLayer(event.target.value)}
                placeholder={t("orchestrator.systemLayerPlaceholder")}
                rows={4}
              />
              <p className="text-[11px] text-muted-foreground">
                {t("orchestrator.systemLayerHint")}
              </p>
            </div>
          )}
          <SelectControl
            label={t("orchestrator.llmModel")}
            value={state.llmModelId}
            options={state.chatModels.map((model) => ({
              value: model.id,
              label: model.name || model.model,
            }))}
            onChange={state.setLlmModelId}
            disabled={state.chatModels.length === 0}
          />
          {state.chatModels.length === 0 && (
            <p className="text-xs text-destructive">{t("orchestrator.noModels")}</p>
          )}
          <LocalEngineQuickControl onConnected={() => state.setLlmModelId(LOCAL_LLAMA_MODEL_ID)} />
          <SelectControl
            label={t("orchestrator.outputFormat")}
            value={state.outputFormat}
            options={outputFormatOptions(state.mode, state.skill).map((value) => ({
              value,
              label: t(`orchestrator.formats.${value}`),
            }))}
            onChange={(value) => state.setOutputFormat(value as WorkbenchState["outputFormat"])}
          />
          {!videoTask && state.seriesOptions.length > 0 && (
            <div className="space-y-1">
              <SelectControl
                label={t("orchestrator.series")}
                value={state.series}
                options={[
                  { value: "", label: t("orchestrator.allSeries") },
                  ...state.seriesOptions.map((value) => ({ value, label: value })),
                ]}
                onChange={state.setSeries}
              />
              <p className="text-[11px] text-muted-foreground">{t("orchestrator.seriesHint")}</p>
            </div>
          )}
          <label className="flex items-start gap-2 rounded-md bg-muted/30 px-3 py-2 text-xs">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={state.includePayload}
              onChange={(event) => state.setIncludePayload(event.target.checked)}
            />
            <span>{t("orchestrator.includePayload")}</span>
          </label>
          <details className="rounded-lg border border-border/70 p-3">
            <summary className="cursor-pointer text-xs font-medium">{t("orchestrator.advanced")}</summary>
            <div className="mt-3 space-y-3">
              <Input label={t("orchestrator.modelId")} placeholder={t("orchestrator.modelIdPlaceholder")} value={state.modelId} onChange={(event) => state.setModelId(event.target.value)} variant="outlined" />
              <Input label={t("orchestrator.loraIds")} placeholder={t("orchestrator.loraIdsPlaceholder")} value={state.loraIds} onChange={(event) => state.setLoraIds(event.target.value)} variant="outlined" />
              <p className="text-xs text-muted-foreground">{t("orchestrator.loraExplanation")}</p>
              <Input label={t("orchestrator.vocabularyBudget")} type="number" min={0} max={4000} value={state.vocabularyTokenBudget} onChange={(event) => state.setVocabularyTokenBudget(Number(event.target.value))} variant="outlined" />
              {!videoTask && (
                <Input label={t("orchestrator.skillNameOptional")} placeholder={t("orchestrator.skillNamePlaceholder")} value={state.skillName} onChange={(event) => state.setSkillName(event.target.value)} variant="outlined" />
              )}
            </div>
          </details>
        </div>

        <div
          className={`min-h-0 min-w-0 flex-1 overflow-y-auto p-4 ${
            resultExpanded ? "hidden" : "block"
          }`}
        >
          <div className={humanLed ? "grid gap-4 xl:grid-cols-2" : "space-y-4"}>
            <div className="space-y-4">
              <Textarea
                label={t("orchestrator.inputLabel")}
                placeholder={t("orchestrator.inputPlaceholder")}
                value={state.prompt}
                onChange={(event) => state.setPrompt(event.target.value)}
                rows={mossLayoutMode ? 4 : videoTask ? 6 : 10}
              />
              {mossLayoutMode && (
                <PromptMossLayoutCanvas
                  editor={state.mossLayout}
                  onRefineCaptions={() => void state.refineLayoutCaptions()}
                  onReverseFromImage={(file) => void state.reverseLayoutFromImage(file)}
                  isAssisting={state.isAssistingLayout}
                  assistNote={state.layoutAssistNote}
                  assistDisabled={!state.llmModelId}
                />
              )}
              {state.mode === "edit" && (
                <Textarea label={t("orchestrator.editInstruction")} value={state.editInstruction} onChange={(event) => state.setEditInstruction(event.target.value)} rows={3} />
              )}
              {state.mode === "random" && (
                <div className="grid gap-3 rounded-lg border border-border p-3">
                  <Input label={t("orchestrator.subject")} value={state.subject} onChange={(event) => state.setSubject(event.target.value)} variant="outlined" />
                  <Input label={t("orchestrator.setting")} value={state.setting} onChange={(event) => state.setSetting(event.target.value)} variant="outlined" />
                  <Input label={t("orchestrator.seed")} value={state.seed} onChange={(event) => state.setSeed(event.target.value)} variant="outlined" />
                </div>
              )}
              {videoTask && <PromptVideoFields mode={state.mode} value={state.video} onChange={state.updateVideo} />}
              {supportsReferenceImages(state.mode) && (
                <PromptReferenceImageInput
                  mode={state.mode}
                  images={state.referenceImages}
                  onFiles={(files) => void state.acceptReferenceFiles(files)}
                  onNativePaste={() => void state.pasteReferenceImage()}
                  onRemove={(id) => state.setReferenceImages((images) => images.filter((image) => image.id !== id))}
                />
              )}
            </div>
            {humanLed && (
              <PromptVocabularyPrefabPanel
                series={state.series}
                selectedTerms={state.prefabTerms}
                onAdd={state.addPrefabTerm}
                onRemove={state.removePrefabTerm}
              />
            )}
          </div>
          <div className="sticky bottom-0 -mx-4 mt-4 border-t border-border bg-background px-4 py-3">
            <div className="flex flex-wrap gap-2">
              <Button
                className="min-w-[132px] flex-1 whitespace-nowrap"
                disabled={!state.canRun}
                title={state.canRun ? undefined : state.runBlockers.join(" · ")}
                onClick={() => void state.run()}
              >
                {state.isRunning ? (
                  <LoaderCircleIcon className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <SparklesIcon className="h-4 w-4" aria-hidden="true" />
                )}
                {state.isRunning ? t("orchestrator.running") : t("orchestrator.run")}
              </Button>
              {!videoTask && (
                <Button
                  variant="secondary"
                  className="min-w-[132px] whitespace-nowrap"
                  disabled={!state.canGenerateSkill}
                  onClick={() => void state.generateSkill()}
                >
                  {state.isGeneratingSkill ? (
                    <LoaderCircleIcon className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <FilePlus2Icon className="h-4 w-4" aria-hidden="true" />
                  )}
                  {state.isGeneratingSkill
                    ? t("orchestrator.generatingSkill")
                    : t("orchestrator.generateSkill")}
                </Button>
              )}
            </div>
            {!state.canRun && state.runBlockers.length > 0 && (
              <div
                className="mt-2 space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs"
                data-testid="orchestrator-run-blockers"
              >
                <p className="font-medium">{t("orchestrator.blocker.title")}</p>
                <ul className="list-inside list-disc text-muted-foreground">
                  {state.runBlockers.slice(0, 6).map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          {state.error && (
            <div role="alert" className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {state.error}
            </div>
          )}
        </div>

        <div
          className={`flex min-h-0 flex-col border-border lg:border-l ${
            resultExpanded
              ? "min-w-0 flex-1"
              : "min-h-[320px] border-t lg:min-h-0 lg:w-[46%] lg:min-w-[420px] lg:border-t-0"
          }`}
        >
          <PromptOrchestratorResultPanel
            result={state.result}
            sourcePrompt={state.prompt}
            skillDraft={state.skillDraft}
            savedSkillId={state.savedSkillId}
            isSavingSkill={state.isSavingSkill}
            onSaveSkill={() => void saveSkill()}
            onCopy={(value) => void copy(value)}
            expanded={resultExpanded}
            onToggleExpanded={() => setResultExpanded((value) => !value)}
            savedPromptId={state.savedPromptId}
            isSavingToLibrary={state.isSavingToLibrary}
            onSaveToLibrary={(favorite) => void saveToLibrary(favorite)}
          />
        </div>
      </div>
    </div>
  );
}
