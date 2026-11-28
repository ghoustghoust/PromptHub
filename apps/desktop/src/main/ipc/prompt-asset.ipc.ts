import fs from "node:fs";
import { ipcMain, nativeImage } from "electron";
import { PromptAssetDB } from "@prompthub/db";
import type Database from "@prompthub/db/adapter";
import { IPC_CHANNELS } from "@prompthub/shared/constants/ipc-channels";
import type {
  PromptAssetIPCReply,
  PromptAssetKindCount,
  PromptAssetQuery,
  PromptAssetQueryResult,
} from "@prompthub/shared/types";

const THUMBNAIL_WIDTH = 320;
const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
const CACHE_LIMIT = 300;

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

function readAssetQuery(value: unknown): PromptAssetQuery {
  if (!value || typeof value !== "object") return {};
  const input = value as Partial<PromptAssetQuery>;
  return {
    ...(typeof input.kind === "string" && input.kind.trim() ? { kind: input.kind.trim() } : {}),
    ...(typeof input.query === "string" && input.query.trim() ? { query: input.query.trim() } : {}),
    ...(typeof input.limit === "number" ? { limit: input.limit } : {}),
    ...(typeof input.offset === "number" ? { offset: input.offset } : {}),
  };
}

/** Decodes one source picture into a small JPEG data URL; never copies the file. */
function renderThumbnail(assetPath: string): string | null {
  try {
    const stat = fs.statSync(assetPath);
    if (!stat.isFile() || stat.size > MAX_SOURCE_BYTES) return null;
    const image = nativeImage.createFromPath(assetPath);
    if (image.isEmpty()) return null;
    const resized = image.resize({ width: THUMBNAIL_WIDTH, quality: "good" });
    return `data:image/jpeg;base64,${resized.toJPEG(72).toString("base64")}`;
  } catch {
    return null;
  }
}

export function registerPromptAssetIPC(db: Database.Database): void {
  const assets = new PromptAssetDB(db);
  const cache = new Map<string, string>();

  ipcMain.handle(IPC_CHANNELS.PROMPT_ASSET_LIST, (_, input: unknown) =>
    reply<PromptAssetQueryResult>(() => assets.list(readAssetQuery(input))),
  );
  ipcMain.handle(IPC_CHANNELS.PROMPT_ASSET_KIND_COUNTS, () =>
    reply<PromptAssetKindCount[]>(() => assets.countByKind()),
  );
  // Thumbnails are resolved from the asset id, so the renderer can never ask the
  // main process to read an arbitrary path off disk.
  ipcMain.handle(IPC_CHANNELS.PROMPT_ASSET_THUMBNAIL, (_, input: unknown) =>
    reply<string | null>(() => {
      if (typeof input !== "string" || !input.trim()) {
        throw new Error("asset id is required");
      }
      const asset = assets.get(input.trim());
      if (!asset?.path) return null;
      const cached = cache.get(asset.id);
      if (cached) return cached;
      const thumbnail = renderThumbnail(asset.path);
      if (!thumbnail) return null;
      if (cache.size >= CACHE_LIMIT) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      cache.set(asset.id, thumbnail);
      return thumbnail;
    }),
  );
}