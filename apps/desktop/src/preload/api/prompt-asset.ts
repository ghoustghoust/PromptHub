import { ipcRenderer } from "electron";
import { IPC_CHANNELS } from "@prompthub/shared/constants/ipc-channels";
import type {
  PromptAssetIPCReply,
  PromptAssetKindCount,
  PromptAssetQuery,
  PromptAssetQueryResult,
} from "@prompthub/shared/types";

/** Read-only picture libraries; pictures stay in the source directory. */
export const promptAssetApi = {
  list: (query: PromptAssetQuery = {}) =>
    ipcRenderer.invoke(IPC_CHANNELS.PROMPT_ASSET_LIST, query) as Promise<
      PromptAssetIPCReply<PromptAssetQueryResult>
    >,
  countByKind: () =>
    ipcRenderer.invoke(IPC_CHANNELS.PROMPT_ASSET_KIND_COUNTS) as Promise<
      PromptAssetIPCReply<PromptAssetKindCount[]>
    >,
  thumbnail: (assetId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.PROMPT_ASSET_THUMBNAIL, assetId) as Promise<
      PromptAssetIPCReply<string | null>
    >,
};