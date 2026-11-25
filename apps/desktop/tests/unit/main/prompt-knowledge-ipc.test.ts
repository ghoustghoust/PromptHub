import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const handleMock = vi.fn();

vi.mock("electron", () => ({
  ipcMain: { handle: handleMock },
}));

type Handler = (event: unknown, input?: unknown) => Promise<unknown>;

async function setup() {
  vi.resetModules();
  handleMock.mockReset();
  const [
    { registerPromptKnowledgeIPC },
    { migratePromptKnowledge },
    { IPC_CHANNELS },
    sqliteModule,
  ] = await Promise.all([
    import("../../../src/main/ipc/prompt-knowledge.ipc"),
    import("@prompthub/db"),
    import("@prompthub/shared/constants/ipc-channels"),
    import("../../../src/main/database/sqlite"),
  ]);
  const DatabaseAdapter = sqliteModule.default;
  const db = new DatabaseAdapter(":memory:");
  db.pragma("foreign_keys = ON");
  migratePromptKnowledge(db);
  registerPromptKnowledgeIPC(db);
  const handlers = Object.fromEntries(
    handleMock.mock.calls.map(([channel, handler]) => [channel, handler]),
  ) as Record<string, Handler>;
  return { db, handlers, IPC_CHANNELS };
}

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "prompthub-knowledge-ipc-"));
  fs.mkdirSync(path.join(root, "知识"), { recursive: true });
  fs.writeFileSync(path.join(root, "SKILL.md"), "---\nname: Pack\nversion: 0.9.0\n---\n");
  fs.writeFileSync(
    path.join(root, "知识", "alpha.md"),
    "---\nmodule: alpha\nname: Alpha\n---\n## Rules\nalpha body",
  );
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("prompt knowledge IPC", () => {
  it("previews a pack and returns the import payload", async () => {
    const { handlers, IPC_CHANNELS, db } = await setup();
    const response = (await handlers[IPC_CHANNELS.PROMPT_KNOWLEDGE_PREVIEW](null, {
      rootPath: root,
    })) as { ok: true; data: { moduleCount: number; packs: Array<{ name: string }> } };

    expect(response.ok).toBe(true);
    expect(response.data.moduleCount).toBe(1);
    expect(response.data.packs[0].name).toBe("Pack");
    db.close();
  });

  it("rejects a preview without a root path", async () => {
    const { handlers, IPC_CHANNELS, db } = await setup();
    const response = (await handlers[IPC_CHANNELS.PROMPT_KNOWLEDGE_PREVIEW](null, {})) as {
      ok: false;
      error: { message: string };
    };
    expect(response.ok).toBe(false);
    expect(response.error.message).toMatch(/rootPath/);
    db.close();
  });

  it("commits, lists, reads modules and removes a pack", async () => {
    const { handlers, IPC_CHANNELS, db } = await setup();
    const preview = (await handlers[IPC_CHANNELS.PROMPT_KNOWLEDGE_PREVIEW](null, {
      rootPath: root,
    })) as { ok: true; data: unknown };
    const committed = (await handlers[IPC_CHANNELS.PROMPT_KNOWLEDGE_COMMIT](null, {
      preview: preview.data,
      packName: "Skill-Film",
    })) as { ok: true; data: { packIds: string[]; moduleCount: number } };
    expect(committed.data.moduleCount).toBe(1);

    const packs = (await handlers[IPC_CHANNELS.PROMPT_KNOWLEDGE_LIST](null)) as {
      ok: true;
      data: Array<{ id: string; name: string }>;
    };
    expect(packs.data).toHaveLength(1);
    expect(packs.data[0].name).toBe("Skill-Film");

    const modules = (await handlers[IPC_CHANNELS.PROMPT_KNOWLEDGE_MODULES](
      null,
      committed.data.packIds[0],
    )) as { ok: true; data: Array<{ moduleKey: string; content: string }> };
    expect(modules.data[0]).toMatchObject({
      moduleKey: "alpha",
      content: "## Rules\nalpha body",
    });

    const removed = (await handlers[IPC_CHANNELS.PROMPT_KNOWLEDGE_REMOVE](
      null,
      committed.data.packIds[0],
    )) as { ok: true; data: { removed: boolean } };
    expect(removed.data.removed).toBe(true);
    const after = (await handlers[IPC_CHANNELS.PROMPT_KNOWLEDGE_LIST](null)) as {
      ok: true;
      data: unknown[];
    };
    expect(after.data).toEqual([]);
    db.close();
  });
});