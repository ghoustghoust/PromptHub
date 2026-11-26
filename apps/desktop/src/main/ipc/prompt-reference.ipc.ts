import { ipcMain } from "electron";
import { PromptReferenceDB } from "@prompthub/db";
import type Database from "@prompthub/db/adapter";
import { IPC_CHANNELS } from "@prompthub/shared/constants/ipc-channels";
import type {
  PromptKnowledgeIPCReply,
  PromptReferenceImportCommitResult,
  PromptReferenceImportPreview,
  PromptReferenceItem,
} from "@prompthub/shared/types";
import {
  commitReferenceImport,
  previewReferenceLibrary,
} from "../services/prompt-reference-service";
import { readLibraryThumbnails } from "../services/library-thumbnails";

async function reply<T>(
  operation: () => T | Promise<T>,
): Promise<PromptKnowledgeIPCReply<T>> {
  try {
    return { ok: true, data: await operation() };
  } catch (error) {
    console.error("Prompt reference IPC operation failed", error);
    return {
      ok: false,
      error: {
        code: "REFERENCE_IPC_ERROR",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

/** The joint index needs the source roots; an empty list is a mistake. */
function rootsOf(input: unknown): string[] {
  const roots =
    input && typeof input === "object" && Array.isArray((input as { roots?: unknown }).roots)
      ? (input as { roots: unknown[] }).roots
      : [];
  const cleaned = roots
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim());
  if (cleaned.length === 0) throw new Error("At least one source root is required");
  return cleaned;
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

export function registerPromptReferenceIPC(db: Database.Database): void {
  const references = new PromptReferenceDB(db);
  ipcMain.handle(IPC_CHANNELS.PROMPT_REFERENCE_LIST, () =>
    reply<PromptReferenceItem[]>(() => references.list()),
  );
  ipcMain.handle(IPC_CHANNELS.PROMPT_REFERENCE_REMOVE, (_, input: unknown) =>
    reply<{ removed: boolean }>(() => {
      if (typeof input !== "string" || !input.trim()) throw new Error("reference id is required");
      return { removed: references.remove(input.trim()) };
    }),
  );
  ipcMain.handle(IPC_CHANNELS.PROMPT_REFERENCE_PREVIEW, (_, input: unknown) =>
    reply<PromptReferenceImportPreview>(() => previewReferenceLibrary(rootsOf(input))),
  );
  ipcMain.handle(IPC_CHANNELS.PROMPT_REFERENCE_IMPORT, (_, input: unknown) =>
    reply<PromptReferenceImportCommitResult>(() => {
      // The main process owns the scan, so the commit writes what it finds now.
      const preview = previewReferenceLibrary(rootsOf(input));
      return commitReferenceImport(references, preview);
    }),
  );
  ipcMain.handle(IPC_CHANNELS.PROMPT_REFERENCE_THUMBNAILS, (_, input: unknown) =>
    reply<Record<string, string>>(() => {
      const ids = idsOf(input);
      const rows = ids
        .map((id) => references.get(id))
        .filter((row): row is PromptReferenceItem => row !== null);
      return readLibraryThumbnails(
        rows.map((row) => ({ id: row.id, path: row.thumbnailPath ?? null })),
      );
    }),
  );
}
