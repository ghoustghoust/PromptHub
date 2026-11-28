import fs from "node:fs";
import path from "node:path";
import { app, ipcMain, nativeImage } from "electron";
import { PromptAssetDB, SettingsDB } from "@prompthub/db";
import type Database from "@prompthub/db/adapter";
import { IPC_CHANNELS } from "@prompthub/shared/constants/ipc-channels";
import type {
  PromptAssetIPCReply,
  PromptAssetKindCount,
  PromptAssetQuery,
  PromptAssetQueryResult,
} from "@prompthub/shared/types";
import { commitAssetImport, previewAssetLibrary } from "../services/prompt-asset-service";

const THUMBNAIL_WIDTH = 320;
const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
const CACHE_LIMIT = 300;
const LIBRARY_ROOT_SETTING = "promptAssetLibraryRoot";
const LIBRARY_FOLDER = path.join("library", "image-library", "models", "GHIL");

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
  const settings = new SettingsDB(db);
  const cache = new Map<string, string>();

  /**
   * The default picture library lives outside the database: a folder the user
   * can replace or download. Saved root wins, then the app data folder, then the
   * checkout this desktop build runs from.
   */
  const isLibraryRoot = (folder: string): boolean =>
    fs.existsSync(path.join(folder, "costume", "data", "costume-zh.json"));
  /** A checkout can be launched from `out/main`, `apps/desktop` or the root. */
  const findInCheckout = (start: string): string | null => {
    let current = path.resolve(start);
    for (let depth = 0; depth < 6; depth += 1) {
      const candidate = path.join(current, "prompt", LIBRARY_FOLDER);
      if (fs.existsSync(candidate) && isLibraryRoot(candidate)) return candidate;
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return null;
  };
  const resolveDefaultRoot = (): string | null => {
    const saved = settings.get(LIBRARY_ROOT_SETTING);
    const candidates = [
      ...(typeof saved === "string" && saved.trim() ? [saved.trim()] : []),
      path.join(app.getPath("userData"), LIBRARY_FOLDER),
      findInCheckout(app.getAppPath()),
      findInCheckout(process.cwd()),
    ].filter((folder): folder is string => Boolean(folder));
    return candidates.find((folder) => fs.existsSync(folder) && isLibraryRoot(folder)) ?? null;
  };

  ipcMain.handle(IPC_CHANNELS.PROMPT_ASSET_DEFAULT_ROOT, () =>
    reply<string | null>(() => resolveDefaultRoot()),
  );
  // Scanning only writes the index; pictures stay where they are, and the same
  // folder can be rescanned without duplicating rows.
  ipcMain.handle(IPC_CHANNELS.PROMPT_ASSET_IMPORT, (_, input: unknown) => {
    return reply<{
      root: string;
      counts: Record<string, number>;
      inserted: number;
      updated: number;
      skipped: number;
      conflicts: number;
    }>(() => {
      const requested =
        input && typeof input === "object" && typeof (input as { root?: unknown }).root === "string"
          ? ((input as { root: string }).root ?? "").trim()
          : "";
      const root = requested || resolveDefaultRoot();
      if (!root) throw new Error("No image library folder was found; choose one first.");
      if (!isLibraryRoot(root)) {
        throw new Error("That folder does not contain the four indexed libraries.");
      }
      const preview = previewAssetLibrary(root);
      const result = commitAssetImport(assets, preview);
      settings.set({ [LIBRARY_ROOT_SETTING]: root });
      cache.clear();
      return {
        root,
        counts: preview.counts,
        inserted: result.inserted,
        updated: result.updated,
        skipped: preview.skipped.length,
        conflicts: preview.conflicts.length,
      };
    });
  });

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