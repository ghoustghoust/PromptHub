import { ipcRenderer } from "electron";
import { IPC_CHANNELS } from "@prompthub/shared/constants/ipc-channels";
import type {
  DesktopPromptAssetImportRequest,
  DesktopPromptAssetListRequest,
  DesktopPromptAssetPreviewRequest,
  DesktopPromptAssetThumbnailRequest,
  PromptAssetIPCReply,
  PromptAssetImportCommitResult,
  PromptAssetImportPreview,
  PromptAssetKindCount,
  PromptAssetQueryResult,
} from "@prompthub/shared/types";

export const promptAssetApi = {
  preview: (request: DesktopPromptAssetPreviewRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.PROMPT_ASSET_PREVIEW, request) as Promise<
      PromptAssetIPCReply<PromptAssetImportPreview>
    >,
  importLibrary: (request: DesktopPromptAssetImportRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.PROMPT_ASSET_IMPORT, request) as Promise<
      PromptAssetIPCReply<PromptAssetImportCommitResult>
    >,
  list: (request: DesktopPromptAssetListRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.PROMPT_ASSET_LIST, request) as Promise<
      PromptAssetIPCReply<PromptAssetQueryResult>
    >,
  kindCounts: () =>
    ipcRenderer.invoke(IPC_CHANNELS.PROMPT_ASSET_KIND_COUNTS) as Promise<
      PromptAssetIPCReply<PromptAssetKindCount[]>
    >,
  thumbnails: (request: DesktopPromptAssetThumbnailRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.PROMPT_ASSET_THUMBNAILS, request) as Promise<
      PromptAssetIPCReply<Record<string, string>>
    >,
};
