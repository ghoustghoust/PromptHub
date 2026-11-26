import { ipcMain } from "electron";
import { PromptAssetDB } from "@prompthub/db";
import type Database from "@prompthub/db/adapter";
import { IPC_CHANNELS } from "@prompthub/shared/constants/ipc-channels";
import type {
  PromptAssetIPCReply,
  PromptAssetImportCommitResult,
  PromptAssetImportPreview,
  PromptAssetKindCount,
  PromptAssetQueryResult,
  PromptSourceAsset,
} from "@prompthub/shared/types";
import {
  commitAssetImport,
  previewAssetLibrary,
} from "../services/prompt-asset-service";
import { readLibraryThumbnails } from "../services/library-thumbnails";

async function reply<T>(
  operation: () => T | Promise<T>,
): Promise<PromptAssetIPCReply<T>> {
  try {
    return { ok: true, data: await operation() };
  } catch (error) {
    console.error("Prompt asset IPC operation failed", error);
    return {
      ok: false,
      error: {
        code: "ASSET_IPC_ERROR",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function rootPathOf(input: unknown): string {
  const rootPath =
    input && typeof input === "object" && typeof (input as { rootPath?: unknown }).rootPath === "string"
      ? (input as { rootPath: string }).rootPath.trim()
      : "";
  if (!rootPath) throw new Error("rootPath is required");
  return rootPath;
}

function idsOf(input: unknown): string[] {
  const ids =
    input && typeof input === "object" && Array.isArray((input as { ids?: unknown }).ids)
      ? (input as { ids: unknown[] }).ids
      : [];
  return ids
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim())
    .slice(0, 200);
}

export function registerPromptAssetIPC(db: Database.Database): void {
  const assets = new PromptAssetDB(db);

  ipcMain.handle(IPC_CHANNELS.PROMPT_ASSET_PREVIEW, (_, input: unknown) =>
    reply<PromptAssetImportPreview>(() => previewAssetLibrary(rootPathOf(input))),
  );
  ipcMain.handle(IPC_CHANNELS.PROMPT_ASSET_IMPORT, (_, input: unknown) =>
    reply<PromptAssetImportCommitResult>(() => {
      // The main process owns the scan, so the commit writes what it finds now.
      const preview = previewAssetLibrary(rootPathOf(input));
      return commitAssetImport(assets, preview);
    }),
  );
  ipcMain.handle(IPC_CHANNELS.PROMPT_ASSET_LIST, (_, input: unknown) =>
    reply<PromptAssetQueryResult>(() => {
      const request = (input ?? {}) as {
        kind?: unknown;
        query?: unknown;
        limit?: unknown;
        offset?: unknown;
      };
      return assets.list({
        ...(typeof request.kind === "string" && request.kind.trim()
          ? { kind: request.kind.trim() }
          : {}),
        ...(typeof request.query === "string" && request.query.trim()
          ? { query: request.query.trim() }
          : {}),
        ...(typeof request.limit === "number" ? { limit: request.limit } : {}),
        ...(typeof request.offset === "number" ? { offset: request.offset } : {}),
      });
    }),
  );
  ipcMain.handle(IPC_CHANNELS.PROMPT_ASSET_KIND_COUNTS, () =>
    reply<PromptAssetKindCount[]>(() => assets.countByKind()),
  );
  ipcMain.handle(IPC_CHANNELS.PROMPT_ASSET_THUMBNAILS, (_, input: unknown) =>
    reply<Record<string, string>>(() => {
      const ids = idsOf(input);
      const rows = ids
        .map((id) => assets.get(id))
        .filter((row): row is PromptSourceAsset => row !== null);
      return readLibraryThumbnails(
        rows.map((row) => ({
          id: row.id,
          path: typeof row.meta?.thumbnail === "string" ? row.meta.thumbnail : null,
        })),
      );
    }),
  );
}
