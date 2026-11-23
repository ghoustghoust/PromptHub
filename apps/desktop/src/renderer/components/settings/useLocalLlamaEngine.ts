import { useCallback, useEffect, useRef, useState } from "react";
import type {
  LocalLlamaContextPreset,
  LocalLlamaContextSwitchResult,
  LocalLlamaEngineConfig,
  LocalLlamaEngineStatus,
  LocalLlamaUnloadResult,
} from "@prompthub/shared/types";
import { useSettingsStore } from "../../stores/settings.store";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useLocalLlamaEngine() {
  const connectModel = useSettingsStore(
    (state) => state.connectLocalLlamaModel,
  );
  const [status, setStatus] = useState<LocalLlamaEngineStatus | null>(null);
  const [config, setConfig] = useState<LocalLlamaEngineConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refreshing = useRef(false);
  /** Polling during start/stop only adds IPC churn while the engine is loading. */
  const busyRef = useRef(false);

  const loadConfig = useCallback(async () => {
    if (!window.api.localLlama) return null;
    try {
      const next = await window.api.localLlama.getConfig();
      setConfig(next);
      return next;
    } catch (cause) {
      setError(messageOf(cause));
      return null;
    }
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const refresh = useCallback(async () => {
    if (refreshing.current || busyRef.current || !window.api.localLlama) return;
    refreshing.current = true;
    try {
      setStatus(await window.api.localLlama.getStatus());
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      refreshing.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const connect = useCallback(
    async (snapshot: LocalLlamaEngineStatus | null = status) => {
      try {
        if (!snapshot || snapshot.phase !== "running") {
          throw new Error("The local engine is not ready");
        }
        const model =
          snapshot.models.find((item) => item === "prompthub-local") ??
          snapshot.models[0];
        if (!model) throw new Error("The local engine reported no chat model");
        await connectModel({
          apiUrl: snapshot.endpoint,
          model,
          name: "Local llama.cpp",
          vision: snapshot.vision,
          verifiedAt: new Date().toISOString(),
        });
        setStatus(snapshot);
        setError("");
        return model;
      } catch (cause) {
        setError(messageOf(cause));
        return null;
      }
    },
    [connectModel, status],
  );

  const run = useCallback(
    async (operation: "start" | "stop" | "restart") => {
      if (busy) return null;
      setBusy(true);
      busyRef.current = true;
      setError("");
      try {
        const next = await window.api.localLlama[operation]();
        setStatus(next);
        if (operation !== "stop" && !(await connect(next))) return null;
        return next;
      } catch (cause) {
        const message = messageOf(cause);
        busyRef.current = false;
        await refresh();
        setError(message);
        return null;
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [busy, connect, refresh],
  );

  const start = useCallback(() => run("start"), [run]);
  const stop = useCallback(() => run("stop"), [run]);
  const restart = useCallback(() => run("restart"), [run]);

  /** Explicitly unload so llama-server gives VRAM and RAM back to the desktop. */
  const unload = useCallback(async (): Promise<LocalLlamaUnloadResult | null> => {
    if (busy) return null;
    setBusy(true);
    busyRef.current = true;
    setError("");
    try {
      const result = await window.api.localLlama.unload();
      setStatus(result.status);
      return result;
    } catch (cause) {
      const message = messageOf(cause);
      busyRef.current = false;
      await refresh();
      setError(message);
      return null;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [busy, refresh]);

  /** Switches context through the preflight/unload/rollback path in the main process. */
  const switchContextPreset = useCallback(
    async (
      preset: LocalLlamaContextPreset,
      startIfStopped = true,
    ): Promise<LocalLlamaContextSwitchResult | null> => {
      if (busy) return null;
      setBusy(true);
      busyRef.current = true;
      setError("");
      try {
        const result = await window.api.localLlama.switchContextPreset(
          preset,
          startIfStopped,
        );
        setStatus(result.status);
        await loadConfig();
        if (result.status.phase === "running" && !(await connect(result.status))) {
          return null;
        }
        return result;
      } catch (cause) {
        setError(messageOf(cause));
        await refresh();
        return null;
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [busy, connect, loadConfig, refresh],
  );

  /** Saves engine parameters and restarts so the new context budget takes effect. */
  const saveAndRestart = useCallback(
    async (patch: Partial<LocalLlamaEngineConfig>) => {
      if (busy) return null;
      setBusy(true);
      busyRef.current = true;
      setError("");
      try {
        const current = config ?? (await window.api.localLlama.getConfig());
        const saved = await window.api.localLlama.saveConfig({ ...current, ...patch });
        setConfig(saved);
        const next = await window.api.localLlama.restart();
        setStatus(next);
        if (!(await connect(next))) return null;
        return next;
      } catch (cause) {
        setError(messageOf(cause));
        busyRef.current = false;
        await refresh();
        return null;
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [busy, config, connect, refresh],
  );

  return {
    status,
    config,
    busy,
    error,
    setError,
    refresh,
    loadConfig,
    connect,
    start,
    stop,
    restart,
    unload,
    saveAndRestart,
    switchContextPreset,
  };
}
