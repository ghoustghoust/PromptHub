import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  FilePlus2Icon,
  LoaderCircleIcon,
  PlayIcon,
  PowerOffIcon,
  Settings2Icon,
  SparklesIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { supportsReferenceImages } from "@prompthub/shared/types";
import { estimatePromptTokens } from "@prompthub/shared/utils/prompt-token-estimate";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Select } from "../ui/Select";
import { Textarea } from "../ui/Textarea";
import { useToast } from "../ui/Toast";
import { usePromptOrchestratorWorkbench } from "./usePromptOrchestratorWorkbench";
import { PromptOrchestratorResultPanel } from "./PromptOrchestratorResultPanel";
import { useLocalLlamaEngine } from "../settings/useLocalLlamaEngine";
import { LocalContextPresetPicker } from "../settings/LocalContextPresetPicker";
import { LocalEngineProgress } from "../settings/LocalEngineProgress";
import { LOCAL_LLAMA_MODEL_ID } from "../../stores/settings/settings-ai-actions";
import { useUIStore } from "../../stores/ui.store";
import { PromptReferenceImageInput } from "./PromptReferenceImageInput";
import { PromptVideoFields } from "./PromptVideoFields";
import { PromptTermPicker } from "./PromptTermPicker";
import { PromptMossLayoutCanvas } from "./PromptMossLayoutCanvas";
import { PromptWritingLayerPanel } from "./PromptWritingLayerPanel";
import {
  PREFAB_CATEGORIES,
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

function LocalEngineQuickControl({
  engine,
  layerTokens,
  onConnected,
  onUnloaded,
}: {
  engine: ReturnType<typeof useLocalLlamaEngine>;
  layerTokens: number;
  onConnected: () => void;
  onUnloaded: () => void;
}) {
  const { t } = useTranslation();
  const requestSettingsSection = useUIStore(
    (state) => state.requestSettingsSection,
  );
  const running = engine.status?.phase === "running";
  const canUnload = running || engine.status?.phase === "error";
  const external = running && !engine.status?.managed;
  const [paramsOpen, setParamsOpen] = useState(false);
  const [confirmExternal, setConfirmExternal] = useState(false);
  const [unloadNote, setUnloadNote] = useState("");
  const [contextSize, setContextSize] = useState("");
  const [imageTokens, setImageTokens] = useState("");
  const [gpuLayers, setGpuLayers] = useState("");
  const [mtpEnabled, setMtpEnabled] = useState(false);
  const [kvUnified, setKvUnified] = useState(true);

  useEffect(() => {
    if (!confirmExternal) return;
    const timer = window.setTimeout(() => setConfirmExternal(false), 5000);
    return () => window.clearTimeout(timer);
  }, [confirmExternal]);

  useEffect(() => {
    if (!engine.config) return;
    setContextSize(String(engine.config.contextSize));
    setImageTokens(String(engine.config.imageMaxTokens));
    setGpuLayers(String(engine.config.gpuLayers));
    setMtpEnabled(engine.config.mtpEnabled);
    setKvUnified(engine.config.kvUnified);
  }, [engine.config]);

  const start = async () => {
    setUnloadNote("");
    setConfirmExternal(false);
    if (await engine.start()) onConnected();
  };

  const unload = async () => {
    // An engine PromptHub did not start is a user process; confirm before ending it.
    if (external && !confirmExternal) {
      setConfirmExternal(true);
      return;
    }
    setConfirmExternal(false);
    const result = await engine.unload();
    if (!result) return;
    setUnloadNote(
      result.freedGpuMb === null
        ? t("localModel.unloaded")
        : t("localModel.unloadedWithMemory", {
            size: `${(result.freedGpuMb / 1024).toFixed(1)} GB`,
          }),
    );
    onUnloaded();
  };

  const openComfy = async () => {
    const url = engine.config?.comfyUrl?.trim();
    if (!url) {
      setUnloadNote(t("localModel.comfyUrlMissing"));
      return;
    }
    if (running) {
      // Never end an external engine without the same confirmation as unload.
      if (external && !confirmExternal) {
        setConfirmExternal(true);
        return;
      }
      setConfirmExternal(false);
      const result = await engine.unload();
      if (!result) return;
      setUnloadNote(
        result.freedGpuMb === null
          ? t("localModel.unloaded")
          : t("localModel.unloadedWithMemory", {
              size: `${(result.freedGpuMb / 1024).toFixed(1)} GB`,
            }),
      );
      onUnloaded();
    }
    const opened = await window.electron?.openExternal?.(url);
    if (opened !== true) {
      setUnloadNote(t("localModel.comfyOpenFailed"));
    }
  };

  const applyParams = async () => {
    const ctx = Number(contextSize);
    const image = Number(imageTokens);
    const layers = Number(gpuLayers);
    if (!Number.isInteger(ctx) || ctx < 512 || !Number.isInteger(image) || image < 0) return;
    if (!Number.isInteger(layers) || layers < -1 || layers > 999) return;
    if (await engine.saveAndRestart({
      contextSize: ctx,
      imageMaxTokens: image,
      gpuLayers: layers,
      mtpEnabled,
      kvUnified,
    })) {
      onConnected();
    }
  };

  const applyContextPreset = async (preset: "8k" | "32k" | "64k") => {
    const result = await engine.switchContextPreset(preset, true);
    if (result?.status.phase === "running") onConnected();
  };

  return (
    <div className="space-y-2 rounded-lg border border-border/70 bg-muted/20 p-3" data-testid="orchestrator-local-engine">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 text-xs">
          <span className={`h-2 w-2 shrink-0 rounded-full ${running ? "bg-emerald-500" : "bg-muted-foreground"}`} />
          <span className="truncate">
            {t("localModel.menu")} · {engine.status ? t(`localModel.phase.${engine.status.phase}`) : t("localModel.checking")}
          </span>
        </div>        <div className="flex flex-wrap items-center justify-end gap-1">
          {!running && (
            <Button size="sm" variant="secondary" onClick={() => void start()} disabled={engine.busy} data-testid="orchestrator-engine-start">
              <PlayIcon className="h-3.5 w-3.5" />{t("localModel.start")}
            </Button>
          )}
          <Button
            size="sm"
            variant={confirmExternal ? "danger" : "secondary"}
            onClick={() => void unload()}
            disabled={!canUnload || engine.busy}
            data-testid="orchestrator-engine-unload"
          >
            {engine.busy ? (
              <LoaderCircleIcon className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <PowerOffIcon className="h-3.5 w-3.5" />
            )}
            {confirmExternal ? t("localModel.unloadConfirm") : t("orchestrator.localEngine.releaseMemory")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void openComfy()}
            disabled={engine.busy}
            data-testid="orchestrator-engine-open-comfy"
          >
            {t("orchestrator.localEngine.openComfy")}
          </Button>
          <Button size="sm" variant="ghost" aria-label={t("localModel.menu")} onClick={() => requestSettingsSection("localModel")}>
            <Settings2Icon className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      {(engine.busy || engine.status?.phase === "starting") && (
        <LocalEngineProgress
          phase={engine.status?.phase ?? "starting"}
          stage={engine.status?.stage ?? "spawn"}
          startedAt={engine.progressStartedAt}
          eventLoopDelayMs={engine.status?.eventLoopDelayMs}
        />
      )}
      {unloadNote && (
        <p className="text-[11px] text-emerald-600 dark:text-emerald-400" data-testid="orchestrator-engine-unloaded">
          {unloadNote}
        </p>
      )}
      {external && <p className="text-[11px] text-muted-foreground">{t("localModel.unloadExternalHint")}</p>}
      {external && (
        <p className="text-[11px] text-muted-foreground">{t("localModel.externalQuitHint")}</p>
      )}
      {canUnload && (
        <p className="text-[11px] text-muted-foreground">{t("orchestrator.localEngine.releaseHint")}</p>
      )}
      {engine.error && <p className="text-xs text-destructive">{engine.error}</p>}
      {running && engine.status?.onGpu === false && (
        <p className="text-[11px] text-destructive" data-testid="orchestrator-engine-cpu-fallback">
          {t("orchestrator.localEngine.cpuFallback")}
        </p>
      )}
      <button
        type="button"
        className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
        onClick={() => setParamsOpen((open) => !open)}
        data-testid="orchestrator-engine-params-toggle"
      >
        {t("orchestrator.localEngine.params")}
        {engine.config
          ? ` · ${engine.config.contextSize} ctx / ${engine.config.imageMaxTokens} img`
          : ""}
      </button>
      {paramsOpen && (
        <div className="space-y-2">
          <LocalContextPresetPicker
            contextSize={engine.config?.contextSize ?? 8192}
            kvCacheType={engine.config?.kvCacheType ?? "q8_0"}
            kvOffload={engine.config?.kvOffload ?? true}
            disabled={engine.busy}
            hint={
              engine.config &&
              engine.config.contextSize < 32768 &&
              layerTokens > 0
                ? t("orchestrator.localEngine.contextNeedLayer", { tokens: layerTokens })
                : undefined
            }
            onSelect={(preset) => void applyContextPreset(preset)}
          />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Input
              label={t("orchestrator.localEngine.context")}
              type="number"
              min={512}
              step={512}
              value={contextSize}
              onChange={(event) => setContextSize(event.target.value)}
              variant="outlined"
              data-testid="orchestrator-engine-context"
            />
            <Input
              label={t("orchestrator.localEngine.imageTokens")}
              type="number"
              min={0}
              step={256}
              value={imageTokens}
              onChange={(event) => setImageTokens(event.target.value)}
              variant="outlined"
              data-testid="orchestrator-engine-image-tokens"
            />
            <Input
              label={t("orchestrator.localEngine.gpuLayers")}
              type="number"
              min={-1}
              value={gpuLayers}
              onChange={(event) => setGpuLayers(event.target.value)}
              variant="outlined"
              data-testid="orchestrator-engine-gpu-layers"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={mtpEnabled}
                onChange={(event) => setMtpEnabled(event.target.checked)}
                data-testid="orchestrator-engine-mtp"
              />
              {t("orchestrator.localEngine.mtp")}
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={kvUnified}
                onChange={(event) => setKvUnified(event.target.checked)}
                data-testid="orchestrator-engine-kv-unified"
              />
              {t("orchestrator.localEngine.kvUnified")}
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void applyParams()}
              disabled={engine.busy}
              data-testid="orchestrator-engine-apply"
            >
              {t("orchestrator.localEngine.applyRestart")}
            </Button>
            <span className="text-[11px] text-muted-foreground">
              {t("orchestrator.localEngine.restartHint")}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export function PromptOrchestratorWorkbench() {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const state = usePromptOrchestratorWorkbench();
  const engine = useLocalLlamaEngine();
  const [resultExpanded, setResultExpanded] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);
  const [pickerExpanded, setPickerExpanded] = useState(false);
  const [intentCollapsed, setIntentCollapsed] = useState(false);
  const [workspaceTab, setWorkspaceTab] = useState<"picker" | "canvas">("picker");
  const [resultWidth, setResultWidth] = useState(520);
  const [wideLayout, setWideLayout] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 1440px)").matches,
  );
  const resizeOrigin = useRef<{ x: number; width: number } | null>(null);

  // A local engine owns the real context size; cloud runs declare it explicitly.
  useEffect(() => {
    if (state.modelSource !== "local") return;
    const contextSize = engine.config?.contextSize;
    if (contextSize && contextSize !== state.layerContextTokens) {
      state.setLayerContextTokens(contextSize);
    }
  }, [engine.config?.contextSize, state.modelSource, state.layerContextTokens]);
  const modeOptions = taskModesForSkill(state.skill).map((value) => ({
    value,
    label: t(`orchestrator.modes.${value}`),
  }));
  const videoTask = isVideoTask(state.mode);
  const humanLed = state.guidanceMode === "human-led" && !videoTask;
  const layoutMode = !videoTask && state.outputFormat === "layout";
  const dynamicPolish = state.mode === "polish" && state.guidanceMode === "agent-led" && !layoutMode;
  const selectedCount = state.prefabTerms.filter((term) => term.state !== "excluded").length;
  const lockedCount = state.prefabTerms.filter((term) => term.state === "locked").length;
  const excludedCount = state.prefabTerms.filter((term) => term.state === "excluded").length;
  const archiveCount =
    (state.modelId.trim() ? 1 : 0) +
    state.loraIds.split(",").map((item) => item.trim()).filter(Boolean).length;
  const hasResultContent = Boolean(state.result || state.skillDraft);
  useEffect(() => {
    setResultExpanded(false);
    setResultOpen(hasResultContent);
  }, [hasResultContent]);
  useEffect(() => {
    if (!humanLed) {
      setPickerExpanded(false);
      setIntentCollapsed(false);
    }
  }, [humanLed]);
  // Exact-placement work belongs on the canvas; word picking belongs on the picker.
  useEffect(() => {
    if (!humanLed) return;
    setWorkspaceTab(layoutMode ? "canvas" : "picker");
  }, [humanLed, layoutMode]);
  const usablePrefabTerms = state.prefabTerms.filter((term) => term.state !== "excluded");
  const lockTermsIntoBox = () => {
    const box = state.mossLayout.selectedBox;
    if (!box || usablePrefabTerms.length === 0) return;
    const addition = usablePrefabTerms
      .map((term) => term.template ?? term.en)
      .join(", ");
    state.mossLayout.updateBox(box.id, {
      caption: [box.caption?.trim(), addition].filter(Boolean).join(", "),
    });
  };
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1440px)");
    const onChange = () => setWideLayout(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  const beginResultResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizeOrigin.current = { x: event.clientX, width: resultWidth };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const resizeResult = (event: ReactPointerEvent<HTMLDivElement>) => {
    const origin = resizeOrigin.current;
    if (!origin) return;
    const next = origin.width + (origin.x - event.clientX);
    const maxWidth = Math.max(440, Math.min(640, window.innerWidth - 300 - 560));
    setResultWidth(Math.min(maxWidth, Math.max(440, next)));
  };
  const endResultResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    resizeOrigin.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
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
      <div className="relative flex min-h-0 flex-1 flex-col lg:flex-row">
        <div
          className={`shrink-0 space-y-4 overflow-y-auto border-b border-border p-4 lg:border-b-0 lg:border-r ${
            humanLed ? "lg:w-[280px] xl:w-[300px]" : "lg:w-[320px]"
          } ${resultExpanded || pickerExpanded ? "hidden" : "block"}`}
          data-testid="orchestrator-config-panel"
        >
          <SelectControl
            label={t("orchestrator.skill")}
            value={state.skill}
            options={[
              { value: "moodyMoss", label: t("orchestrator.skills.moodyMoss") },
              { value: "moss", label: t("orchestrator.skills.moss") },
              { value: "k2", label: t("orchestrator.skills.k2") },
              { value: "minimaxH3", label: t("orchestrator.skills.minimaxH3") },
            ]}
            onChange={(value) => state.setSkill(value as WorkbenchState["skill"])}
          />
          <div
            className="space-y-1 rounded-lg border border-border/60 bg-muted/20 px-3 py-2"
            data-testid="orchestrator-shared-selection"
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
              <span className="font-medium text-foreground">{t("orchestrator.shared.label")}</span>
              <span>{t("orchestrator.shared.selected", { count: selectedCount })}</span>
              <span>{t("orchestrator.shared.locked", { count: lockedCount })}</span>
              <span>{t("orchestrator.shared.excluded", { count: excludedCount })}</span>
              <span>{t("orchestrator.shared.archive", { count: archiveCount })}</span>
            </div>
            <p className="text-[11px] text-muted-foreground">{t("orchestrator.shared.hint")}</p>
          </div>
          <SelectControl
            label={t("orchestrator.mode")}
            value={state.mode}
            options={modeOptions}
            onChange={(value) => state.setMode(value as WorkbenchState["mode"])}
          />
          {!videoTask && (
            <div className="space-y-1">
              <SelectControl
                label={t("orchestrator.targetPipeline")}
                value={state.targetPipeline}
                options={[
                  { value: "", label: t("orchestrator.pipelines.follow") },
                  { value: "anima", label: t("orchestrator.pipelines.anima") },
                  { value: "kaloscope", label: t("orchestrator.pipelines.kaloscope") },
                ]}
                onChange={(value) =>
                  state.setTargetPipeline(value as WorkbenchState["targetPipeline"])
                }
              />
              <p className="text-[11px] text-muted-foreground">
                {t("orchestrator.targetPipelineHint")}
              </p>
            </div>
          )}
          <div className="space-y-1 rounded-lg border border-primary/20 bg-primary/5 p-3" data-testid="orchestrator-mode-guide">
            <p className="text-xs font-medium text-primary">{t(`orchestrator.modeDetails.${state.mode}`)}</p>
            <p className="text-xs text-muted-foreground">{t(`orchestrator.modeInputs.${state.mode}`)}</p>
            {dynamicPolish && (
              <p className="text-xs text-muted-foreground" data-testid="orchestrator-dynamic-polish-hint">
                {t("orchestrator.dynamicPolish.hint")}
              </p>
            )}
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
            <div className="space-y-2">
              {state.writingLayer.mode === "custom" && (
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
              )}
              <PromptWritingLayerPanel
                selection={state.writingLayer}
                text={state.systemLayer}
                source={state.systemLayerSource ?? null}
                disabled={state.isRunning}
                contextTokens={state.layerContextTokens}
                contextLocked={state.modelSource === "local"}
                budget={state.layerBudget}
                budgetError={state.layerBudgetError}
                onSelectionChange={state.setWritingLayer}
                onTextChange={state.updateSystemLayerWithSource}
                onContextTokensChange={state.setLayerContextTokens}
              />
            </div>
          )}
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-foreground">
              {t("orchestrator.modelSource.label")}
            </span>
            <div
              className="grid grid-cols-2 gap-1 rounded-md border border-border bg-muted/30 p-1"
              role="group"
              aria-label={t("orchestrator.modelSource.label")}
            >
              {(["cloud", "local"] as const).map((source) => (
                <button
                  key={source}
                  type="button"
                  aria-pressed={state.modelSource === source}
                  onClick={() => state.changeModelSource(source)}
                  className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                    state.modelSource === source
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  data-testid={`orchestrator-model-source-${source}`}
                >
                  {t(`orchestrator.modelSource.${source}`)}
                </button>
              ))}
            </div>
          </div>
          {state.modelSource === "cloud" ? (
            <>
              <SelectControl
                label={t("orchestrator.llmModel")}
                value={state.llmModelId}
                options={state.cloudModels.map((model) => ({
                  value: model.id,
                  label: model.name || model.model,
                }))}
                onChange={state.setLlmModelId}
                disabled={state.cloudModels.length === 0}
              />
              <p className="text-[11px] text-muted-foreground">
                {t("orchestrator.modelSource.cloudHint")}
              </p>
              {state.cloudModels.length === 0 && (
                <p className="text-xs text-destructive">{t("orchestrator.modelSource.noCloud")}</p>
              )}
            </>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-xs">
                <span className="text-muted-foreground">{t("orchestrator.modelSource.localModel")}</span>
                <span className="truncate font-medium">
                  {state.localModel?.name || t("orchestrator.modelSource.localNotConnected")}
                </span>
              </div>
              <LocalEngineQuickControl
                engine={engine}
                layerTokens={estimatePromptTokens(state.systemLayer)}
                onConnected={() => state.setLlmModelId(LOCAL_LLAMA_MODEL_ID)}
                onUnloaded={() => state.changeModelSource("cloud")}
              />
              <p className="text-[11px] text-muted-foreground">
                {t("orchestrator.modelSource.localHint")}
              </p>
            </>
          )}
          <SelectControl
            label={t("orchestrator.outputFormat")}
            value={state.outputFormat}
            options={outputFormatOptions(state.mode, state.skill).map((value) => ({
              value,
              label: t(`orchestrator.formats.${value}`),
            }))}
            onChange={(value) => state.setOutputFormat(value as WorkbenchState["outputFormat"])}
          />
          {dynamicPolish && (
            <SelectControl
              label={t("orchestrator.dynamicPolish.domainLabel")}
              value={state.domain}
              options={(["all", "shared", "anime", "real", "3d"] as const).map((value) => ({
                value,
                label: t(`orchestrator.dynamicPolish.domain.${value}`),
              }))}
              onChange={(value) => state.setDomain(value as WorkbenchState["domain"])}
            />
          )}
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
          className={`min-h-0 min-w-0 flex-1 ${
            humanLed ? "flex flex-col overflow-hidden" : "overflow-y-auto p-4"
          } ${resultExpanded ? "hidden" : ""}`}
          data-testid="orchestrator-workspace"
        >
          <div className={humanLed ? "flex min-h-0 flex-1 flex-col" : "space-y-4"}>
            <div
              className={
                humanLed
                  ? `${pickerExpanded ? "hidden" : "block"} shrink-0 space-y-2 border-b border-border/60 bg-muted/10 p-3`
                  : "space-y-4"
              }
              data-testid="orchestrator-intent-panel"
            >
              {humanLed && (
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 text-left"
                  onClick={() => setIntentCollapsed((value) => !value)}
                  aria-expanded={!intentCollapsed}
                  data-testid="orchestrator-intent-toggle"
                >
                  <span className="text-sm font-medium text-foreground">
                    {t("orchestrator.inputLabel")}
                  </span>
                  <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    {intentCollapsed
                      ? t("orchestrator.expandIntent")
                      : t("orchestrator.collapseIntent")}
                    {intentCollapsed ? (
                      <ChevronDownIcon className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <ChevronUpIcon className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                  </span>
                </button>
              )}
              {(!humanLed || !intentCollapsed) && (
                <Textarea
                  label={humanLed ? undefined : t("orchestrator.inputLabel")}
                  aria-label={t("orchestrator.inputLabel")}
                  placeholder={t("orchestrator.inputPlaceholder")}
                  value={state.prompt}
                  onChange={(event) => state.setPrompt(event.target.value)}
                  rows={humanLed ? 3 : layoutMode ? 4 : videoTask ? 6 : 10}
                  className={humanLed ? "min-h-[80px] py-2" : undefined}
                />
              )}
              {(!humanLed || !intentCollapsed) && state.promptOrigin === "result" && (
                <div
                  className="flex items-center justify-between gap-2 rounded-md bg-primary/5 px-2 py-1 text-[11px] text-primary"
                  data-testid="orchestrator-intent-origin"
                >
                  <span>{t("orchestrator.intentFromResult")}</span>
                  <button
                    type="button"
                    className="text-muted-foreground underline-offset-2 hover:underline"
                    onClick={state.clearPromptOrigin}
                  >
                    {t("orchestrator.clearIntentOrigin")}
                  </button>
                </div>
              )}
              {!humanLed && layoutMode && (
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
                  <div className="space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">
                      {t("orchestrator.randomCategories")}
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {PREFAB_CATEGORIES.map((category) => {
                        const active = state.randomCategories.includes(category);
                        return (
                          <button
                            key={category}
                            type="button"
                            aria-pressed={active}
                            onClick={() => state.toggleRandomCategory(category)}
                            className={`rounded border px-2 py-0.5 text-[11px] transition-colors ${
                              active
                                ? "border-primary/50 bg-primary/10 text-primary"
                                : "border-border text-muted-foreground hover:text-foreground"
                            }`}
                            data-testid={`random-category-${category}`}
                          >
                            {t(`orchestrator.categories.${category}`, category)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
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
                  onClear={() => state.setReferenceImages([])}
                />
              )}
            </div>
            {humanLed && (
              <>
                {layoutMode && (
                  <div
                    className="flex shrink-0 items-center gap-1 border-b border-border/60 px-3 py-1.5"
                    role="tablist"
                    data-testid="orchestrator-workspace-tabs"
                  >
                    {(["picker", "canvas"] as const).map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        role="tab"
                        aria-selected={workspaceTab === tab}
                        onClick={() => setWorkspaceTab(tab)}
                        className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                          workspaceTab === tab
                            ? "bg-primary/10 text-primary"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground"
                        }`}
                        data-testid={`orchestrator-workspace-tab-${tab}`}
                      >
                        {t(`orchestrator.workspace.${tab}`)}
                      </button>
                    ))}
                    <span className="ml-auto truncate text-[11px] text-muted-foreground">
                      {t("orchestrator.workspace.layoutHint")}
                    </span>
                  </div>
                )}
                <div className="flex min-h-0 flex-1 flex-col">
                  {layoutMode && workspaceTab === "canvas" ? (
                    <>
                      {usablePrefabTerms.length > 0 && (
                        <div
                          className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border/60 bg-muted/10 px-3 py-2"
                          data-testid="orchestrator-canvas-terms"
                        >
                          <span className="text-[11px] text-muted-foreground">
                            {t("orchestrator.workspace.lockedHint", {
                              count: usablePrefabTerms.length,
                            })}
                          </span>
                          {usablePrefabTerms.slice(0, 8).map((term) => (
                            <span
                              key={term.id}
                              className="max-w-[220px] truncate rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary"
                              title={term.template ?? term.en}
                            >
                              {term.template ?? term.en}
                            </span>
                          ))}
                          <Button
                            size="sm"
                            variant="secondary"
                            className="ml-auto"
                            disabled={!state.mossLayout.selectedBox}
                            onClick={lockTermsIntoBox}
                            data-testid="orchestrator-canvas-insert-terms"
                          >
                            {t("orchestrator.workspace.insertTerms")}
                          </Button>
                        </div>
                      )}
                      <div className="min-h-0 flex-1 overflow-y-auto p-3">
                        <PromptMossLayoutCanvas
                          editor={state.mossLayout}
                          onRefineCaptions={() => void state.refineLayoutCaptions()}
                          onReverseFromImage={(file) => void state.reverseLayoutFromImage(file)}
                          isAssisting={state.isAssistingLayout}
                          assistNote={state.layoutAssistNote}
                          assistDisabled={!state.llmModelId}
                        />
                      </div>
                    </>
                  ) : (
                    <div className="min-h-0 flex-1 p-3">
                      <PromptTermPicker
                        series={state.series}
                        seriesOptions={state.seriesOptions}
                        selectedTerms={state.prefabTerms}
                        onSeriesChange={state.setSeries}
                        onAdd={state.addPrefabTerm}
                        onRemove={state.removePrefabTerm}
                        onStateChange={state.setPrefabTermState}
                        onClear={state.clearPrefabTerms}
                        expanded={pickerExpanded}
                        onToggleExpanded={() => {
                          setPickerExpanded((value) => !value);
                          setResultExpanded(false);
                          setResultOpen(false);
                        }}
                      />
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
          <div
            className={
              humanLed
                ? "shrink-0 border-t border-border bg-background px-4 py-3"
                : "sticky bottom-0 -mx-4 mt-4 border-t border-border bg-background px-4 py-3"
            }
          >
            <div className={`flex gap-2 ${humanLed ? "flex-nowrap" : "flex-wrap"}`}>
              <Button
                className="min-w-[132px] flex-1 whitespace-nowrap"
                disabled={!state.canRun}
                title={state.canRun ? undefined : state.runBlockers.join(" · ")}
                onClick={() => void state.run()}
                data-testid="orchestrator-run"
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

        {humanLed && hasResultContent && !resultOpen && !pickerExpanded && (
          <Button
            variant="secondary"
            size="sm"
            className="absolute right-4 top-4 z-20 shadow-lg"
            onClick={() => setResultOpen(true)}
            data-testid="orchestrator-result-open"
          >
            <SparklesIcon className="h-3.5 w-3.5" aria-hidden="true" />
            {t("orchestrator.viewResult")}
          </Button>
        )}

        {(!humanLed || (hasResultContent && resultOpen)) && (
          <div
            className={`flex min-h-0 flex-col border-border ${
              resultExpanded
                ? "relative min-w-0 flex-1"
                : humanLed
                  ? "absolute inset-y-0 right-0 z-30 w-[min(680px,88%)] border-l bg-background shadow-2xl xl:relative xl:z-auto xl:w-[42%] xl:min-w-[440px] xl:max-w-[640px] xl:bg-transparent xl:shadow-none"
                  : "relative min-h-[320px] border-t lg:min-h-0 lg:w-[46%] lg:min-w-[420px] lg:border-l lg:border-t-0"
            }`}
            style={
              humanLed && wideLayout && !resultExpanded
                ? { width: resultWidth }
                : undefined
            }
            data-testid="orchestrator-result-slot"
          >
            {humanLed && wideLayout && !resultExpanded && (
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label={t("orchestrator.resizeResult")}
                title={t("orchestrator.resizeResult")}
                className="absolute inset-y-0 left-0 z-10 w-1.5 -translate-x-1/2 cursor-col-resize touch-none hover:bg-primary/40"
                onPointerDown={beginResultResize}
                onPointerMove={resizeResult}
                onPointerUp={endResultResize}
                onPointerCancel={endResultResize}
                data-testid="orchestrator-result-resize"
              />
            )}
            <PromptOrchestratorResultPanel
              result={state.result}
              sourcePrompt={state.prompt}
              skillDraft={state.skillDraft}
              savedSkillId={state.savedSkillId}
              isSavingSkill={state.isSavingSkill}
              onSaveSkill={() => void saveSkill()}
              onCopy={(value) => void copy(value)}
              expanded={resultExpanded}
              onToggleExpanded={() => {
                setResultExpanded((value) => !value);
                setPickerExpanded(false);
                setResultOpen(true);
              }}
              onClose={humanLed ? () => {
                setResultOpen(false);
                setResultExpanded(false);
              } : undefined}
              savedPromptId={state.savedPromptId}
              isSavingToLibrary={state.isSavingToLibrary}
              onSaveToLibrary={(favorite) => void saveToLibrary(favorite)}
              onBackfillTerms={state.backfillResultTerms}
              streaming={state.streaming}
              runStats={state.lastRunStats}
              onReuseAsIntent={state.reuseResultAsIntent}
              onCancel={() => void state.cancelRun()}
              canceling={state.canceling}
            />
          </div>
        )}
      </div>
    </div>
  );
}
