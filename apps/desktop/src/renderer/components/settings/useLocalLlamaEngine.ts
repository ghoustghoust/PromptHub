import { useCallback, useEffect, useRef, useState } from "react";
import type { LocalLlamaEngineStatus } from "@prompthub/shared/types";
import { useSettingsStore } from "../../stores/settings.store";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useLocalLlamaEngine() {
  const connectModel = useSettingsStore(
    (state) => state.connectLocalLlamaModel,
  );
  const [status, setStatus] = useState<LocalLlamaEngineStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refreshing = useRef(false);

  const refresh = useCallback(async () => {
    if (refreshing.current || !window.api.localLlama) return;
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
      setError("");
      try {
        const next = await window.api.localLlama[operation]();
        setStatus(next);
        if (operation !== "stop" && !(await connect(next))) return null;
        return next;
      } catch (cause) {
        const message = messageOf(cause);
        await refresh();
        setError(message);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [busy, connect, refresh],
  );

  const start = useCallback(() => run("start"), [run]);
  const stop = useCallback(() => run("stop"), [run]);
  const restart = useCallback(() => run("restart"), [run]);

  return { status, busy, error, setError, refresh, connect, start, stop, restart };
}
