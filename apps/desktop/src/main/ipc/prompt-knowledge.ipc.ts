import { ipcMain } from "electron";
import { PromptKnowledgeDB } from "@prompthub/db";
import type Database from "@prompthub/db/adapter";
import { IPC_CHANNELS } from "@prompthub/shared/constants/ipc-channels";
import type {
  PromptKnowledgeIPCReply,
  PromptKnowledgeImportCommitResult,
  PromptKnowledgeImportPreview,
  PromptKnowledgeModule,
  PromptKnowledgePack,
} from "@prompthub/shared/types";
import {
  commitKnowledgeImport,
  previewKnowledgePack,
} from "../services/prompt-knowledge-service";

async function reply<T>(
  operation: () => T | Promise<T>,
): Promise<PromptKnowledgeIPCReply<T>> {
  try {
    return { ok: true, data: await operation() };
  } catch (error) {
    console.error("Prompt knowledge IPC operation failed", error);
    return {
      ok: false,
      error: {
        code: "KNOWLEDGE_IPC_ERROR",
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

function packIdOf(input: unknown): string {
  if (typeof input !== "string" || !input.trim()) {
    throw new Error("packId is required");
  }
  return input.trim();
}

export function registerPromptKnowledgeIPC(db: Database.Database): void {
  const knowledge = new PromptKnowledgeDB(db);

  ipcMain.handle(IPC_CHANNELS.PROMPT_KNOWLEDGE_PREVIEW, (_, input: unknown) =>
    reply<PromptKnowledgeImportPreview>(() => previewKnowledgePack(rootPathOf(input))),
  );
  ipcMain.handle(IPC_CHANNELS.PROMPT_KNOWLEDGE_COMMIT, (_, input: unknown) =>
    reply<PromptKnowledgeImportCommitResult>(() => {
      if (!input || typeof input !== "object") {
        throw new Error("A preview is required to import a knowledge pack");
      }
      const request = input as {
        preview?: PromptKnowledgeImportPreview;
        packName?: unknown;
        moduleKeys?: unknown;
      };
      if (!request.preview || !Array.isArray(request.preview.packs)) {
        throw new Error("A valid preview is required to import a knowledge pack");
      }
      const moduleKeys = Array.isArray(request.moduleKeys)
        ? request.moduleKeys.filter((entry): entry is string => typeof entry === "string")
        : undefined;
      return commitKnowledgeImport(knowledge, request.preview, {
        ...(typeof request.packName === "string" ? { packName: request.packName } : {}),
        ...(moduleKeys ? { moduleKeys } : {}),
      });
    }),
  );
  ipcMain.handle(IPC_CHANNELS.PROMPT_KNOWLEDGE_LIST, () =>
    reply<PromptKnowledgePack[]>(() => knowledge.listPacks()),
  );
  ipcMain.handle(IPC_CHANNELS.PROMPT_KNOWLEDGE_MODULES, (_, input: unknown) =>
    reply<PromptKnowledgeModule[]>(() => knowledge.listModules(packIdOf(input))),
  );
  ipcMain.handle(IPC_CHANNELS.PROMPT_KNOWLEDGE_REMOVE, (_, input: unknown) =>
    reply<{ removed: boolean }>(() => ({ removed: knowledge.deletePack(packIdOf(input)) })),
  );
}