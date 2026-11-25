import { ipcRenderer } from "electron";
import { IPC_CHANNELS } from "@prompthub/shared/constants/ipc-channels";
import type {
  DesktopPromptKnowledgeCommitRequest,
  DesktopPromptKnowledgePreviewRequest,
  PromptKnowledgeIPCReply,
  PromptKnowledgeImportCommitResult,
  PromptKnowledgeImportPreview,
  PromptKnowledgeModule,
  PromptKnowledgePack,
} from "@prompthub/shared/types";

export const promptKnowledgeApi = {
  previewPack: (request: DesktopPromptKnowledgePreviewRequest) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.PROMPT_KNOWLEDGE_PREVIEW,
      request,
    ) as Promise<PromptKnowledgeIPCReply<PromptKnowledgeImportPreview>>,
  commitImport: (request: DesktopPromptKnowledgeCommitRequest) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.PROMPT_KNOWLEDGE_COMMIT,
      request,
    ) as Promise<PromptKnowledgeIPCReply<PromptKnowledgeImportCommitResult>>,
  listPacks: () =>
    ipcRenderer.invoke(IPC_CHANNELS.PROMPT_KNOWLEDGE_LIST) as Promise<
      PromptKnowledgeIPCReply<PromptKnowledgePack[]>
    >,
  listModules: (packId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.PROMPT_KNOWLEDGE_MODULES, packId) as Promise<
      PromptKnowledgeIPCReply<PromptKnowledgeModule[]>
    >,
  removePack: (packId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.PROMPT_KNOWLEDGE_REMOVE, packId) as Promise<
      PromptKnowledgeIPCReply<{ removed: boolean }>
    >,
};