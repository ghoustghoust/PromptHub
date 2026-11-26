import { ipcRenderer } from "electron";
import { IPC_CHANNELS } from "@prompthub/shared/constants/ipc-channels";
import type {
  DesktopPromptReferenceImportRequest,
  DesktopPromptReferencePreviewRequest,
  DesktopPromptReferenceThumbnailRequest,
  PromptKnowledgeIPCReply,
  PromptReferenceImportCommitResult,
  PromptReferenceImportPreview,
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
  preview: (request: DesktopPromptReferencePreviewRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.PROMPT_REFERENCE_PREVIEW, request) as Promise<
      PromptKnowledgeIPCReply<PromptReferenceImportPreview>
    >,
  importLibrary: (request: DesktopPromptReferenceImportRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.PROMPT_REFERENCE_IMPORT, request) as Promise<
      PromptKnowledgeIPCReply<PromptReferenceImportCommitResult>
    >,
  thumbnails: (request: DesktopPromptReferenceThumbnailRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.PROMPT_REFERENCE_THUMBNAILS, request) as Promise<
      PromptKnowledgeIPCReply<Record<string, string>>
    >,
};
