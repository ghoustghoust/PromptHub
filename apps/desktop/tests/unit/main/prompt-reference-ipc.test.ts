import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const handleMock = vi.fn();

vi.mock("electron", () => ({
  ipcMain: { handle: handleMock },
  nativeImage: {
    createFromPath: () => ({
      isEmpty: () => false,
      getSize: () => ({ width: 640, height: 480 }),
      resize: () => ({ toJPEG: () => Buffer.from("jpeg-bytes") }),
      toJPEG: () => Buffer.from("jpeg-bytes"),
    }),
  },
}));

type Handler = (event: unknown, input?: unknown) => Promise<unknown>;

async function setup() {
  vi.resetModules();
  handleMock.mockReset();
  const [
    { registerPromptReferenceIPC },
    { migratePromptReference },
    { IPC_CHANNELS },
    sqliteModule,
  ] = await Promise.all([
    import("../../../src/main/ipc/prompt-reference.ipc"),
    import("@prompthub/db"),
    import("@prompthub/shared/constants/ipc-channels"),
    import("../../../src/main/database/sqlite"),
  ]);
  const DatabaseAdapter = sqliteModule.default;
  const db = new DatabaseAdapter(":memory:");
  db.pragma("foreign_keys = ON");
  migratePromptReference(db);
  registerPromptReferenceIPC(db);
  const handlers = Object.fromEntries(
    handleMock.mock.calls.map(([channel, handler]) => [channel, handler]),
  ) as Record<string, Handler>;
  return { db, handlers, IPC_CHANNELS };
}

let root: string;

function writeCard(target: string, id: string, summary: string): void {
  const dir = path.join(target, "01_黑色悬疑与冷调惊悚", `00${id}_Test_测试导演`);
  fs.mkdirSync(path.join(dir, "assets", "color_palettes"), { recursive: true });
  fs.mkdirSync(path.join(dir, "assets", "references"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "assets", "color_palettes", "palette.json"),
    JSON.stringify({
      director: { id, name_zh: "测试导演", category: "01_黑色悬疑与冷调惊悚" },
      palette: { primary: [{ hex: "#112233" }] },
    }),
  );
  fs.writeFileSync(
    path.join(dir, "assets", "references", "reference_director_manifest.json"),
    JSON.stringify({ style_profile: { definition: summary } }),
  );
  fs.writeFileSync(path.join(dir, "assets", "color_palettes", "palette_main.png"), Buffer.from("png"));
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "prompthub-reference-ipc-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("prompt reference IPC", () => {
  it("previews the merged cards of the given roots", async () => {
    const { handlers, IPC_CHANNELS, db } = await setup();
    writeCard(root, "1", "冷调。");
    const second = fs.mkdtempSync(path.join(os.tmpdir(), "prompthub-reference-ipc-b-"));
    writeCard(second, "1", "冷调。");

    const response = (await handlers[IPC_CHANNELS.PROMPT_REFERENCE_PREVIEW](null, {
      roots: [root, second],
    })) as { ok: true; data: { items: unknown[]; conflicts: unknown[] } };

    expect(response.ok).toBe(true);
    expect(response.data.items).toHaveLength(1);
    expect(response.data.conflicts).toEqual([]);
    db.close();
    fs.rmSync(second, { recursive: true, force: true });
  });

  it("rejects a preview without a source root", async () => {
    const { handlers, IPC_CHANNELS, db } = await setup();
    const response = (await handlers[IPC_CHANNELS.PROMPT_REFERENCE_PREVIEW](null, {
      roots: [],
    })) as { ok: false; error: { message: string } };
    expect(response.ok).toBe(false);
    expect(response.error.message).toMatch(/root/);
    db.close();
  });

  it("imports the cards and reads them back with their thumbnails", async () => {
    const { handlers, IPC_CHANNELS, db } = await setup();
    writeCard(root, "1", "冷调。");

    const imported = (await handlers[IPC_CHANNELS.PROMPT_REFERENCE_IMPORT](null, {
      roots: [root],
    })) as { ok: true; data: { itemIds: string[] } };
    expect(imported.ok).toBe(true);
    expect(imported.data.itemIds).toHaveLength(1);

    const listed = (await handlers[IPC_CHANNELS.PROMPT_REFERENCE_LIST](null)) as {
      ok: true;
      data: Array<{ id: string }>;
    };
    expect(listed.data).toHaveLength(1);

    const thumbnails = (await handlers[IPC_CHANNELS.PROMPT_REFERENCE_THUMBNAILS](null, {
      ids: listed.data.map((row) => row.id),
    })) as { ok: true; data: Record<string, string> };
    expect(thumbnails.ok).toBe(true);
    expect(thumbnails.data[listed.data[0].id]).toMatch(/^data:image\/jpeg;base64,/);
    db.close();
  });
});
