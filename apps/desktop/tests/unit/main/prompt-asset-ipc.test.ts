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
    { registerPromptAssetIPC },
    { IPC_CHANNELS },
    sqliteModule,
  ] = await Promise.all([
    import("../../../src/main/ipc/prompt-asset.ipc"),
    import("@prompthub/shared/constants/ipc-channels"),
    import("../../../src/main/database/sqlite"),
  ]);
  const DatabaseAdapter = sqliteModule.default;
  const db = new DatabaseAdapter(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec((await import("@prompthub/db")).SCHEMA_TABLES);
  registerPromptAssetIPC(db);
  const handlers = Object.fromEntries(
    handleMock.mock.calls.map(([channel, handler]) => [channel, handler]),
  ) as Record<string, Handler>;
  return { db, handlers, IPC_CHANNELS };
}

let root: string;

function write(relativePath: string, content: string | Buffer): void {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "prompthub-asset-ipc-"));
  write("costume/img/SPR-0001.jpg", Buffer.from("jpg"));
  write("costume/thumbs/SPR-0001.webp", Buffer.from("webp"));
  write("costume/data/costume-zh.json", JSON.stringify([
    {
      id: "SPR-0001",
      分类: "春装",
      关键词: ["象牙白"],
      英文关键词: "ivory",
      缩略图: "thumbs/SPR-0001.webp",
      原图: "img/SPR-0001.jpg",
    },
  ]));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("prompt asset IPC", () => {
  it("previews a library and rejects a request without a root path", async () => {
    const { handlers, IPC_CHANNELS, db } = await setup();
    const preview = (await handlers[IPC_CHANNELS.PROMPT_ASSET_PREVIEW](null, {
      rootPath: root,
    })) as { ok: true; data: { items: unknown[]; counts: Record<string, number> } };
    expect(preview.ok).toBe(true);
    expect(preview.data.items).toHaveLength(1);
    expect(preview.data.counts.costume).toBe(1);

    const invalid = (await handlers[IPC_CHANNELS.PROMPT_ASSET_PREVIEW](null, {})) as {
      ok: false;
      error: { message: string };
    };
    expect(invalid.ok).toBe(false);
    expect(invalid.error.message).toMatch(/rootPath/);
    db.close();
  });

  it("imports the library and lists it with a filter", async () => {
    const { handlers, IPC_CHANNELS, db } = await setup();
    const imported = (await handlers[IPC_CHANNELS.PROMPT_ASSET_IMPORT](null, {
      rootPath: root,
    })) as { ok: true; data: { assetIds: string[]; inserted: number } };
    expect(imported.ok).toBe(true);
    expect(imported.data.inserted).toBe(1);

    const listed = (await handlers[IPC_CHANNELS.PROMPT_ASSET_LIST](null, {
      kind: "costume",
    })) as { ok: true; data: { items: Array<{ id: string }>; total: number } };
    expect(listed.data.total).toBe(1);
    expect(listed.data.items[0].id).toBe("ghil:costume:SPR-0001");

    const empty = (await handlers[IPC_CHANNELS.PROMPT_ASSET_LIST](null, {
      kind: "pose",
    })) as { ok: true; data: { total: number } };
    expect(empty.data.total).toBe(0);

    const counts = (await handlers[IPC_CHANNELS.PROMPT_ASSET_KIND_COUNTS](null)) as {
      ok: true;
      data: Array<{ kind: string; count: number }>;
    };
    expect(counts.data).toEqual([{ kind: "costume", count: 1 }]);
    db.close();
  });

  it("hands out the thumbnails of the listed assets", async () => {
    const { handlers, IPC_CHANNELS, db } = await setup();
    await handlers[IPC_CHANNELS.PROMPT_ASSET_IMPORT](null, { rootPath: root });

    const thumbnails = (await handlers[IPC_CHANNELS.PROMPT_ASSET_THUMBNAILS](null, {
      ids: ["ghil:costume:SPR-0001"],
    })) as { ok: true; data: Record<string, string> };
    expect(thumbnails.ok).toBe(true);
    expect(thumbnails.data["ghil:costume:SPR-0001"]).toMatch(/^data:image\/jpeg;base64,/);
    db.close();
  });
});
