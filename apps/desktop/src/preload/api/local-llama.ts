import { ipcRenderer } from "electron";
import { IPC_CHANNELS } from "@prompthub/shared/constants/ipc-channels";
import type {
  LocalLlamaContextPreset,
  LocalLlamaContextSwitchResult,
  LocalLlamaEngineConfig,
  LocalLlamaEngineStatus,
  LocalLlamaUnloadResult,
} from "@prompthub/shared/types";

export const localLlamaApi = {
  getConfig: () =>
    ipcRenderer.invoke(IPC_CHANNELS.LOCAL_LLAMA_CONFIG_GET) as Promise<LocalLlamaEngineConfig>,
  saveConfig: (config: LocalLlamaEngineConfig) =>
    ipcRenderer.invoke(IPC_CHANNELS.LOCAL_LLAMA_CONFIG_SAVE, config) as Promise<LocalLlamaEngineConfig>,
  getStatus: () =>
    ipcRenderer.invoke(IPC_CHANNELS.LOCAL_LLAMA_STATUS) as Promise<LocalLlamaEngineStatus>,
  start: () =>
    ipcRenderer.invoke(IPC_CHANNELS.LOCAL_LLAMA_START) as Promise<LocalLlamaEngineStatus>,
  stop: () =>
    ipcRenderer.invoke(IPC_CHANNELS.LOCAL_LLAMA_STOP) as Promise<LocalLlamaEngineStatus>,
  restart: () =>
    ipcRenderer.invoke(IPC_CHANNELS.LOCAL_LLAMA_RESTART) as Promise<LocalLlamaEngineStatus>,
  switchContextPreset: (preset: LocalLlamaContextPreset, startIfStopped = true) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.LOCAL_LLAMA_CONTEXT_SWITCH,
      preset,
      startIfStopped,
    ) as Promise<LocalLlamaContextSwitchResult>,
  unload: () =>
    ipcRenderer.invoke(IPC_CHANNELS.LOCAL_LLAMA_UNLOAD) as Promise<LocalLlamaUnloadResult>,
  selectFile: (kind: "executable" | "model" | "mmproj") =>
    ipcRenderer.invoke(IPC_CHANNELS.LOCAL_LLAMA_SELECT_FILE, kind) as Promise<string | null>,
  readLog: () =>
    ipcRenderer.invoke(IPC_CHANNELS.LOCAL_LLAMA_READ_LOG) as Promise<string>,
};
