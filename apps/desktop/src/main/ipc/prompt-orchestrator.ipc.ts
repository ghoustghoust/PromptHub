import { ipcMain } from "electron";
import { PromptOrchestratorError } from "@prompthub/core";
import type Database from "@prompthub/db/adapter";
import { IPC_CHANNELS } from "@prompthub/shared/constants/ipc-channels";
import type { PromptOrchestratorIPCReply, PromptOrchestratorStreamEvent } from "@prompthub/shared/types";
import {
  DesktopPromptOrchestratorService,
  PromptOrchestratorConfigError,
} from "../services/prompt-orchestrator-service";

function errorCode(error: unknown): string {
  if (
    error instanceof PromptOrchestratorError ||
    error instanceof PromptOrchestratorConfigError
  ) {
    return error.code;
  }
  return "ORCHESTRATOR_IPC_ERROR";
}

async function reply<T>(
  operation: () => T | Promise<T>,
): Promise<PromptOrchestratorIPCReply<T>> {
  try {
    return { ok: true, data: await operation() };
  } catch (error) {
    console.error("Prompt orchestrator IPC operation failed", error);
    return {
      ok: false,
      error: {
        code: errorCode(error),
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

export function registerPromptOrchestratorIPC(
  db: Database.Database,
): void {
  const service = new DesktopPromptOrchestratorService(db);
  const activeRuns = new Map<string, AbortController>();
  ipcMain.handle(IPC_CHANNELS.PROMPT_ORCHESTRATOR_SERIES, () =>
    reply(() => service.listSeries()),
  );
  ipcMain.handle(IPC_CHANNELS.PROMPT_ORCHESTRATOR_RUN, (event, input: unknown) => {
    const runId =
      input && typeof input === "object" && typeof (input as { runId?: unknown }).runId === "string"
        ? ((input as { runId?: string }).runId ?? "").trim()
        : "";
    const controller = runId ? new AbortController() : null;
    if (runId && controller) activeRuns.set(runId, controller);
    const emit = runId
      ? (streamEvent: PromptOrchestratorStreamEvent) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send(IPC_CHANNELS.PROMPT_ORCHESTRATOR_STREAM_EVENT, {
              runId,
              event: streamEvent,
            });
          }
        }
      : undefined;
    return reply(async () => {
      try {
        return await service.run(input, emit, controller?.signal);
      } finally {
        if (runId) activeRuns.delete(runId);
      }
    });
  });
  ipcMain.handle(IPC_CHANNELS.PROMPT_ORCHESTRATOR_CANCEL, (_, runId: unknown) => {
    if (typeof runId !== "string" || !runId.trim()) {
      return { ok: false, error: { code: "INVALID_INPUT", message: "runId is required" } };
    }
    const controller = activeRuns.get(runId.trim());
    if (!controller) {
      return { ok: false, error: { code: "NOT_RUNNING", message: "That run is not active" } };
    }
    controller.abort();
    return { ok: true, data: { cancelled: true } };
  });
  ipcMain.handle(
    IPC_CHANNELS.PROMPT_ORCHESTRATOR_VOCABULARY_SEARCH,
    (_, input: unknown) => reply(() => service.searchTerms(input)),
  );
  ipcMain.handle(
    IPC_CHANNELS.PROMPT_ORCHESTRATOR_VOCABULARY_BROWSE,
    (_, input: unknown) => reply(() => service.browseTerms(input)),
  );
  ipcMain.handle(
    IPC_CHANNELS.PROMPT_ORCHESTRATOR_VOCABULARY_RESOLVE,
    (_, input: unknown) => reply(() => service.resolveTerms(input)),
  );
  ipcMain.handle(
    IPC_CHANNELS.PROMPT_ORCHESTRATOR_GENERATE_SKILL,
    (_, input: unknown) => reply(() => service.generateSkill(input)),
  );
  ipcMain.handle(
    IPC_CHANNELS.PROMPT_ORCHESTRATOR_LAYOUT_CAPTIONS,
    (_, input: unknown) => reply(() => service.refineLayoutCaptions(input)),
  );
  ipcMain.handle(
    IPC_CHANNELS.PROMPT_ORCHESTRATOR_LAYOUT_REVERSE,
    (_, input: unknown) => reply(() => service.reverseLayout(input)),
  );
  ipcMain.handle(
    IPC_CHANNELS.PROMPT_ORCHESTRATOR_FEEDBACK,
    (_, input: unknown) => reply(() => service.submitFeedback(input)),
  );
  ipcMain.handle(IPC_CHANNELS.PROMPT_ORCHESTRATOR_STATE_GET, () =>
    reply(() => service.getWorkspaceState()),
  );
  ipcMain.handle(
    IPC_CHANNELS.PROMPT_ORCHESTRATOR_STATE_SAVE,
    (_, input: unknown) => reply(() => service.saveWorkspaceState(input)),
  );
  ipcMain.handle(
    IPC_CHANNELS.PROMPT_ORCHESTRATOR_LAYER_BUDGET,
    (_, input: unknown) => reply(() => service.getLayerBudget(input)),
  );
}
