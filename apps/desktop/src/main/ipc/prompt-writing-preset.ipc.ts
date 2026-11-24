import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent, type OpenDialogOptions } from "electron";
import type Database from "@prompthub/db/adapter";
import { IPC_CHANNELS } from "@prompthub/shared/constants/ipc-channels";
import type { PromptWritingPresetIPCReply } from "@prompthub/shared/types";
import { DesktopPromptWritingPresetService } from "../services/prompt-writing-preset-service";

function showSenderOwnedOpenDialog(
  event: Pick<IpcMainInvokeEvent, "sender"> | null | undefined,
  options: OpenDialogOptions,
) {
  const parent = event?.sender ? BrowserWindow.fromWebContents(event.sender) : null;
  return parent ? dialog.showOpenDialog(parent, options) : dialog.showOpenDialog(options);
}

async function reply<T>(
  operation: () => T | Promise<T>,
): Promise<PromptWritingPresetIPCReply<T>> {
  try {
    return { ok: true, data: await operation() };
  } catch (error) {
    console.error("Prompt writing preset IPC operation failed", error);
    return {
      ok: false,
      error: {
        code: "WRITING_PRESET_IPC_ERROR",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

export function registerPromptWritingPresetIPC(db: Database.Database): void {
  const service = new DesktopPromptWritingPresetService(db);
  ipcMain.handle(IPC_CHANNELS.PROMPT_WRITING_PRESET_LIST, () =>
    reply(() => service.list()),
  );
  ipcMain.handle(IPC_CHANNELS.PROMPT_WRITING_PRESET_GET, (_, id: unknown) =>
    reply(() => service.get(id)),
  );
  ipcMain.handle(IPC_CHANNELS.PROMPT_WRITING_PRESET_SAVE, (_, input: unknown) =>
    reply(() => service.save(input)),
  );
  ipcMain.handle(IPC_CHANNELS.PROMPT_WRITING_PRESET_DELETE, (_, id: unknown) =>
    reply(() => service.delete(id)),
  );
  ipcMain.handle(IPC_CHANNELS.PROMPT_WRITING_PRESET_IMPORT, async (event) => {
    const selection = await showSenderOwnedOpenDialog(event, {
      properties: ["openFile"],
      filters: [
        { name: "Writing documents", extensions: ["txt", "md", "markdown", "htm", "html"] },
        { name: "All files", extensions: ["*"] },
      ],
    });
    const filePath = selection.canceled ? null : selection.filePaths[0] ?? null;
    if (!filePath) return { ok: true, data: null };
    return reply(() => service.importFile(filePath));
  });
}
