import { ipcMain } from "electron";
import { PromptReferenceDB } from "@prompthub/db";
import type Database from "@prompthub/db/adapter";
import { IPC_CHANNELS } from "@prompthub/shared/constants/ipc-channels";
import type { PromptKnowledgeIPCReply, PromptReferenceItem } from "@prompthub/shared/types";

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
}