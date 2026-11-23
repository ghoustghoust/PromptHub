import { app, dialog, ipcMain } from "electron";
import { IPC_CHANNELS } from "@prompthub/shared/constants/ipc-channels";
import { LocalLlamaEngineService } from "../services/local-llama-engine-service";

let service: LocalLlamaEngineService | null = null;
let quitHookRegistered = false;

function getService(): LocalLlamaEngineService {
  service ??= new LocalLlamaEngineService();
  if (!quitHookRegistered) {
    app.on("before-quit", () => service?.shutdown());
    quitHookRegistered = true;
  }
  return service;
}

export function registerLocalLlamaIPC(): void {
  const engine = getService();
  ipcMain.handle(IPC_CHANNELS.LOCAL_LLAMA_CONFIG_GET, () => engine.readConfig());
  ipcMain.handle(IPC_CHANNELS.LOCAL_LLAMA_CONFIG_SAVE, (_, config: unknown) =>
    engine.saveConfig(config),
  );
  ipcMain.handle(IPC_CHANNELS.LOCAL_LLAMA_STATUS, () => engine.getStatus());
  ipcMain.handle(IPC_CHANNELS.LOCAL_LLAMA_START, () => engine.start());
  ipcMain.handle(IPC_CHANNELS.LOCAL_LLAMA_STOP, () => engine.stop());
  ipcMain.handle(IPC_CHANNELS.LOCAL_LLAMA_RESTART, () => engine.restart());
  ipcMain.handle(
    IPC_CHANNELS.LOCAL_LLAMA_CONTEXT_SWITCH,
    (_, preset: unknown, startIfStopped: unknown) => {
      if (preset !== "8k" && preset !== "32k" && preset !== "64k") {
        throw new Error("Invalid context preset");
      }
      return engine.switchContextPreset(
        preset,
        typeof startIfStopped === "boolean" ? startIfStopped : true,
      );
    },
  );
  ipcMain.handle(IPC_CHANNELS.LOCAL_LLAMA_UNLOAD, () => engine.unload());
  ipcMain.handle(IPC_CHANNELS.LOCAL_LLAMA_READ_LOG, () => engine.readLog());
  ipcMain.handle(
    IPC_CHANNELS.LOCAL_LLAMA_SELECT_FILE,
    async (_, kind: "executable" | "model" | "mmproj") => {
      if (!["executable", "model", "mmproj"].includes(kind)) {
        throw new Error("Invalid local model file selection kind");
      }
      const result = await dialog.showOpenDialog({
        properties: ["openFile"],
        filters:
          kind === "executable"
            ? [
                { name: "llama-server", extensions: ["exe"] },
                { name: "All files", extensions: ["*"] },
              ]
            : [{ name: "GGUF model", extensions: ["gguf"] }],
      });
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
  );
}
