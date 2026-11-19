import { ipcRenderer } from "electron";
import { IPC_CHANNELS } from "@prompthub/shared/constants/ipc-channels";
import type {
  LocalLlamaEngineConfig,
  LocalLlamaEngineStatus,
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
  selectFile: (kind: "executable" | "model" | "mmproj") =>
    ipcRenderer.invoke(IPC_CHANNELS.LOCAL_LLAMA_SELECT_FILE, kind) as Promise<string | null>,
  readLog: () =>
    ipcRenderer.invoke(IPC_CHANNELS.LOCAL_LLAMA_READ_LOG) as Promise<string>,
};
