import { ipcRenderer } from "electron";
import { IPC_CHANNELS } from "@prompthub/shared/constants/ipc-channels";
import type {
  ImportedPromptWritingPreset,
  PromptWritingPreset,
  PromptWritingPresetIPCReply,
  PromptWritingPresetSummary,
  SavePromptWritingPresetInput,
} from "@prompthub/shared/types";

export const promptWritingPresetsApi = {
  list: () =>
    ipcRenderer.invoke(IPC_CHANNELS.PROMPT_WRITING_PRESET_LIST) as Promise<
      PromptWritingPresetIPCReply<PromptWritingPresetSummary[]>
    >,
  get: (id: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.PROMPT_WRITING_PRESET_GET, id) as Promise<
      PromptWritingPresetIPCReply<PromptWritingPreset | null>
    >,
  save: (input: SavePromptWritingPresetInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.PROMPT_WRITING_PRESET_SAVE, input) as Promise<
      PromptWritingPresetIPCReply<PromptWritingPreset>
    >,
  remove: (id: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.PROMPT_WRITING_PRESET_DELETE, id) as Promise<
      PromptWritingPresetIPCReply<{ deleted: boolean }>
    >,
  /** Opens the native picker; returns null when the user cancels. */
  importFile: () =>
    ipcRenderer.invoke(IPC_CHANNELS.PROMPT_WRITING_PRESET_IMPORT) as Promise<
      PromptWritingPresetIPCReply<ImportedPromptWritingPreset | null>
    >,
};
