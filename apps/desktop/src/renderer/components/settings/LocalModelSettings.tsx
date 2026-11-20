import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIcon,
  BrainIcon,
  FileIcon,
  PlayIcon,
  PowerOffIcon,
  RefreshCwIcon,
  SquareIcon,
} from "lucide-react";
import {
  DEFAULT_LOCAL_LLAMA_CONFIG,
  type LocalLlamaEngineConfig,
} from "@prompthub/shared/types";
import { useUIStore } from "../../stores/ui.store";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Select } from "../ui/Select";
import { SettingSection } from "./shared";
import { useLocalLlamaEngine } from "./useLocalLlamaEngine";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function LocalModelSettings() {
  const { t } = useTranslation();
  const engine = useLocalLlamaEngine();
  const requestSettingsSection = useUIStore(
    (state) => state.requestSettingsSection,
  );
  const [config, setConfig] = useState<LocalLlamaEngineConfig>(
    DEFAULT_LOCAL_LLAMA_CONFIG,
  );
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [formError, setFormError] = useState("");
  const [log, setLog] = useState("");
  const [confirmExternal, setConfirmExternal] = useState(false);
  const [unloadNote, setUnloadNote] = useState("");

  useEffect(() => {
    let active = true;
    void window.api.localLlama.getConfig().then((saved) => {
      if (!active) return;
      setConfig(saved);
      setLoaded(true);
    }).catch((error) => setFormError(errorText(error)));
    return () => {
      active = false;
    };
  }, []);

  const update = <K extends keyof LocalLlamaEngineConfig>(
    key: K,
    value: LocalLlamaEngineConfig[K],
  ) => {
    setConfig((current) => ({ ...current, [key]: value }));
    setDirty(true);
  };

  const save = async (): Promise<boolean> => {
    setSaving(true);
    setFormError("");
    try {
      const saved = await window.api.localLlama.saveConfig(config);
      setConfig(saved);
      setDirty(false);
      return true;
    } catch (error) {
      setFormError(errorText(error));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const start = async () => {
    if (!(await save())) return;
    await engine.start();
  };

  const restart = async () => {
    if (!(await engine.stop())) return;
    if (!(await save())) return;
    await engine.start();
  };

  const running = engine.status?.phase === "running";
  const canUnload = running || engine.status?.phase === "error";
  const external = running && !engine.status?.managed;

  useEffect(() => {
    if (!confirmExternal) return;
    const timer = window.setTimeout(() => setConfirmExternal(false), 5000);
    return () => window.clearTimeout(timer);
  }, [confirmExternal]);

  const unload = async () => {
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
  };

  const browse = async (kind: "executable" | "model" | "mmproj") => {
    try {
      const selected = await window.api.localLlama.selectFile(kind);
      if (!selected) return;
      const key = kind === "executable" ? "executablePath" : kind === "model" ? "modelPath" : "mmprojPath";
      update(key, selected);
    } catch (error) {
      setFormError(errorText(error));
    }
  };

  const busy = saving || engine.busy;
  const managedActive = Boolean(
    engine.status?.managed && engine.status.phase !== "stopped",
  );
  const error = formError || engine.error;

  return (
    <div className="space-y-5 pb-8" data-testid="local-model-settings">
      <div>
        <h2 className="text-base font-semibold">{t("localModel.title")}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{t("localModel.subtitle")}</p>
      </div>

      <SettingSection title={t("localModel.statusSection")}>
        <div className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${running ? "bg-emerald-500" : engine.status?.phase === "error" ? "bg-destructive" : "bg-muted-foreground"}`} />
            <strong data-testid="local-engine-status">
              {engine.status ? t(`localModel.phase.${engine.status.phase}`) : t("localModel.checking")}
            </strong>
            {engine.status && (
              <span className="text-xs text-muted-foreground">
                {engine.status.managed ? t("localModel.managed") : t("localModel.external")}
              </span>
            )}
          </div>
          <div className="break-all text-xs text-muted-foreground">
            {engine.status?.endpoint || `http://127.0.0.1:${config.port}/v1`}
            {engine.status?.pid ? ` · PID ${engine.status.pid}` : ""}
          </div>
          {engine.status?.models.length ? (
            <div className="text-xs">Model: {engine.status.models.join(", ")}</div>
          ) : null}
          {engine.status?.message && <div className="text-xs text-muted-foreground">{engine.status.message}</div>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void start()} disabled={busy || managedActive || !loaded} data-testid="local-engine-start">
              <PlayIcon className="h-3.5 w-3.5" />{t("localModel.startAndConnect")}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void engine.stop()} disabled={busy || !managedActive} data-testid="local-engine-stop">
              <SquareIcon className="h-3.5 w-3.5" />{t("localModel.stop")}
            </Button>
            <Button
              size="sm"
              variant={confirmExternal ? "danger" : "secondary"}
              onClick={() => void unload()}
              disabled={busy || !canUnload}
              data-testid="local-engine-unload"
            >
              <PowerOffIcon className="h-3.5 w-3.5" />
              {confirmExternal ? t("localModel.unloadConfirm") : t("localModel.unload")}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void restart()} disabled={busy || !managedActive}>
              <RefreshCwIcon className="h-3.5 w-3.5" />{t("localModel.restart")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => engine.connect()} disabled={!running || busy}>
              <BrainIcon className="h-3.5 w-3.5" />{t("localModel.connect")}
            </Button>
          </div>
          {external && (
            <p className="text-xs text-muted-foreground">{t("localModel.unloadExternalHint")}</p>
          )}
          {unloadNote && (
            <p className="text-xs text-emerald-600 dark:text-emerald-400" data-testid="local-engine-unloaded">
              {unloadNote}
            </p>
          )}
        </div>
      </SettingSection>

      <SettingSection title={t("localModel.filesSection")}>
        <div className="space-y-4 p-4">
          {(["executable", "model", "mmproj"] as const).map((kind) => {
            const key = kind === "executable" ? "executablePath" : kind === "model" ? "modelPath" : "mmprojPath";
            return (
              <div key={kind}>
                <label className="mb-1.5 block text-sm font-medium" htmlFor={`local-${kind}`}>
                  {t(`localModel.${kind}Path`)}
                </label>
                <div className="flex gap-2">
                  <Input id={`local-${kind}`} value={config[key]} onChange={(event) => update(key, event.target.value)} disabled={managedActive} variant="outlined" />
                  <Button variant="secondary" onClick={() => void browse(kind)} disabled={managedActive}>
                    <FileIcon className="h-4 w-4" />{t("localModel.browse")}
                  </Button>
                </div>
              </div>
            );
          })}
          <p className="text-xs text-muted-foreground">{t("localModel.mmprojHint")}</p>
        </div>
      </SettingSection>

      <SettingSection title={t("localModel.parametersSection")}>
        <div className="grid grid-cols-2 gap-4 p-4 md:grid-cols-3">
          <Input label={t("localModel.port")} type="number" value={config.port} onChange={(event) => update("port", Number(event.target.value))} disabled={managedActive} variant="outlined" />
          <Input label={t("localModel.contextSize")} type="number" value={config.contextSize} onChange={(event) => update("contextSize", Number(event.target.value))} disabled={managedActive} variant="outlined" />
          <Input label={t("localModel.gpuLayers")} type="number" min={-1} value={config.gpuLayers} onChange={(event) => update("gpuLayers", Number(event.target.value))} disabled={managedActive} variant="outlined" />
          <Input label={t("localModel.parallel")} type="number" min={1} max={16} value={config.parallel} onChange={(event) => update("parallel", Number(event.target.value))} disabled={managedActive} variant="outlined" />
          <Input label={t("localModel.imageMaxTokens")} type="number" value={config.imageMaxTokens} onChange={(event) => update("imageMaxTokens", Number(event.target.value))} disabled={managedActive} variant="outlined" />
          <div>
            <label className="mb-1.5 block text-sm font-medium">{t("localModel.kvCacheType")}</label>
            <Select ariaLabel={t("localModel.kvCacheType")} value={config.kvCacheType} onChange={(value) => update("kvCacheType", value as LocalLlamaEngineConfig["kvCacheType"])} options={["q8_0", "f16", "q4_0"].map((value) => ({ value, label: value }))} disabled={managedActive} />
          </div>
          <Input label={t("localModel.mtpDraftMax")} type="number" min={1} max={8} value={config.mtpDraftMax} onChange={(event) => update("mtpDraftMax", Number(event.target.value))} disabled={managedActive || !config.mtpEnabled} variant="outlined" />
        </div>
        <div className="flex flex-wrap gap-5 border-t border-border/60 px-4 py-3 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={config.flashAttention} onChange={(event) => update("flashAttention", event.target.checked)} disabled={managedActive} />{t("localModel.flashAttention")}</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={config.mtpEnabled} onChange={(event) => update("mtpEnabled", event.target.checked)} disabled={managedActive} />{t("localModel.mtpEnabled")}</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={config.kvUnified} onChange={(event) => update("kvUnified", event.target.checked)} disabled={managedActive} />{t("localModel.kvUnified")}</label>
        </div>
        <p className="px-4 text-xs text-muted-foreground">{t("localModel.gpuLayersHint")}</p>
        <p className="px-4 pb-4 text-xs text-muted-foreground">{t("localModel.mtpHint")}</p>
      </SettingSection>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => void save()} disabled={busy || managedActive || !dirty} data-testid="local-engine-save">{t("localModel.save")}</Button>
        <Button variant="secondary" onClick={() => requestSettingsSection("ai")}>{t("localModel.openAiSettings")}</Button>
        <Button variant="ghost" onClick={() => void window.api.localLlama.readLog().then(setLog)}>
          <ActivityIcon className="h-4 w-4" />{t("localModel.viewLog")}
        </Button>
        {dirty && <span className="text-xs text-muted-foreground">{t("localModel.unsaved")}</span>}
      </div>
      {error && <div role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>}
      {log && <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/50 p-3 text-[11px]">{log}</pre>}
    </div>
  );
}
