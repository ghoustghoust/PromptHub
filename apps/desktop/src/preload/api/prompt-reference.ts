import { ipcRenderer } from "electron";
import { IPC_CHANNELS } from "@prompthub/shared/constants/ipc-channels";
import type {
  PromptKnowledgeIPCReply,
  PromptReferenceItem,
} from "@prompthub/shared/types";

export const promptReferenceApi = {
  list: () =>
    ipcRenderer.invoke(IPC_CHANNELS.PROMPT_REFERENCE_LIST) as Promise<
      PromptKnowledgeIPCReply<PromptReferenceItem[]>
    >,
  remove: (id: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.PROMPT_REFERENCE_REMOVE, id) as Promise<
      PromptKnowledgeIPCReply<{ removed: boolean }>
    >,
};