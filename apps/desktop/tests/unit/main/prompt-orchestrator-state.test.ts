import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PromptOrchestratorStateDB,
  SCHEMA_TABLES,
} from "@prompthub/db";
import type { PromptOrchestratorWorkspaceState } from "@prompthub/shared/types";
import DatabaseAdapter from "../../../src/main/database/sqlite";
import { DesktopPromptOrchestratorService } from "../../../src/main/services/prompt-orchestrator-service";

let rawDb: DatabaseAdapter.Database;

function state(overrides: Partial<PromptOrchestratorWorkspaceState> = {}): PromptOrchestratorWorkspaceState {
  return {
    prefabTerms: [
      {
        id: "light-1",
        category: "lighting",
        subcategory: null,
        en: "soft light",
        zh: "柔光",
        series: null,
        template: null,
        validationStatus: "validated",
        state: "locked",
      },
      {
        id: "light-2",
        category: "lighting",
        subcategory: null,
        en: "golden hour",
        zh: null,
        series: null,
        template: null,
        validationStatus: "unvalidated",
        state: "excluded",
      },
    ],
    modelId: "moss-base",
    loraIds: "lora-a,lora-b",
    ...overrides,
  };
}

beforeEach(() => {
  rawDb = new DatabaseAdapter(":memory:");
  rawDb.pragma("foreign_keys = ON");
  rawDb.exec(SCHEMA_TABLES);
});

afterEach(() => rawDb.close());

describe("orchestrator workspace state", () => {
  it("round-trips the picker and archive, and upserts a single row", () => {
    const db = new PromptOrchestratorStateDB(rawDb);
    expect(db.get()).toBeNull();
    const saved = db.save(state());
    expect(saved.updatedAt).toBeTruthy();
    expect(db.get()).toMatchObject({
      modelId: "moss-base",
      loraIds: "lora-a,lora-b",
      prefabTerms: [
        expect.objectContaining({ id: "light-1", state: "locked" }),
        expect.objectContaining({ id: "light-2", state: "excluded" }),
      ],
    });
    db.save(state({ modelId: "moss-sft", prefabTerms: [] }));
    expect(db.get()?.modelId).toBe("moss-sft");
    const rows = rawDb.get("SELECT COUNT(*) AS count FROM prompt_orchestrator_state") as {
      count: number;
    };
    expect(rows.count).toBe(1);
  });

  it("validates the IPC payload and deduplicates term ids", () => {
    const service = new DesktopPromptOrchestratorService(rawDb);
    expect(service.getWorkspaceState()).toBeNull();
    const saved = service.saveWorkspaceState({
      ...state(),
      prefabTerms: [
        state().prefabTerms[0],
        state().prefabTerms[0],
        state().prefabTerms[1],
      ],
    });
    expect(saved.prefabTerms.map((term) => term.id)).toEqual(["light-1", "light-2"]);
    expect(service.getWorkspaceState()?.prefabTerms).toHaveLength(2);
  });

  it("rejects unsupported states, statuses and overlong archive values", () => {
    const service = new DesktopPromptOrchestratorService(rawDb);
    expect(() =>
      service.saveWorkspaceState({
        ...state(),
        prefabTerms: [{ ...state().prefabTerms[0], state: "maybe" }],
      }),
    ).toThrow("Unsupported prefab term state");
    expect(() =>
      service.saveWorkspaceState({
        ...state(),
        prefabTerms: [{ ...state().prefabTerms[0], validationStatus: "verified" }],
      }),
    ).toThrow("validation status");
    expect(() => service.saveWorkspaceState(state({ modelId: "x".repeat(501) }))).toThrow(
      "length limit",
    );
    expect(() => service.saveWorkspaceState({ ...state(), modelId: "bad\0id" })).toThrow(
      "null byte",
    );
  });

  it("round-trips the writing layer selection and rejects a bad variant", () => {
    const service = new DesktopPromptOrchestratorService(rawDb);
    const saved = service.saveWorkspaceState({
      ...state(),
      systemLayerText: "## First\nAlpha body.",
      systemLayerSource: "MOSS writing core",
      writingPresetId: "builtin-moss-writing-core",
      writingPresetVariant: "original",
      writingPresetSectionIds: ["1-first", "2-second"],
    });
    expect(saved.writingPresetId).toBe("builtin-moss-writing-core");
    expect(service.getWorkspaceState()).toMatchObject({
      systemLayerText: "## First\nAlpha body.",
      systemLayerSource: "MOSS writing core",
      writingPresetId: "builtin-moss-writing-core",
      writingPresetVariant: "original",
      writingPresetSectionIds: ["1-first", "2-second"],
    });

    expect(() =>
      service.saveWorkspaceState({
        ...state(),
        writingPresetVariant: "full" as never,
      }),
    ).toThrow("compressed or original");
    expect(() =>
      service.saveWorkspaceState({
        ...state(),
        writingPresetSectionIds: ["x".repeat(201)],
      }),
    ).toThrow("writingPresetSectionIds");
    expect(() =>
      service.saveWorkspaceState({
        ...state(),
        systemLayerText: "x".repeat(60_001),
      }),
    ).toThrow("length limit");
  });

  it("keeps a long writing layer intact after closing and reopening the database", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "prompthub-orchestrator-state-"));
    const file = path.join(directory, "prompthub.db");
    const layerText = "## Section\n" + "x".repeat(54_000);
    try {
      const first = new DatabaseAdapter(file);
      first.exec(SCHEMA_TABLES);
      const saved = new PromptOrchestratorStateDB(first).save(state({ systemLayerText: layerText }));
      expect(saved.systemLayerText).toHaveLength(layerText.length);
      first.close();

      const second = new DatabaseAdapter(file);
      try {
        expect(new PromptOrchestratorStateDB(second).get()?.systemLayerText).toHaveLength(
          layerText.length,
        );
      } finally {
        second.close();
      }
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects a writing layer above the transport limit instead of truncating it", () => {
    const db = new PromptOrchestratorStateDB(rawDb);
    expect(() => db.save(state({ systemLayerText: "x".repeat(60_001) }))).toThrow(
      "60000",
    );
    expect(db.get()).toBeNull();
  });

  it("treats a corrupted row as empty instead of breaking the workbench", () => {
    rawDb
      .prepare(
        "INSERT INTO prompt_orchestrator_state (id, state_json, updated_at) VALUES ('default', ?, ?)",
      )
      .run("{not json", Date.now());
    const service = new DesktopPromptOrchestratorService(rawDb);
    expect(service.getWorkspaceState()).toBeNull();
  });

  it("round-trips the canvas draft verbatim and rejects invalid boxes", () => {
    const service = new DesktopPromptOrchestratorService(rawDb);
    const mossLayout = {
      version: 1 as const,
      canvas: { width: 1536, height: 1024 },
      boxes: [
        {
          id: "box-1",
          label: "text" as const,
          caption: "  keeps surrounding spaces  ",
          text: "EXACT",
          bbox: [10, 20, 300, 400] as [number, number, number, number],
        },
        {
          id: "box-2",
          label: "object" as const,
          caption: "A tower",
          character: true,
          needsReview: true,
          bbox: [400, 100, 900, 800] as [number, number, number, number],
        },
      ],
    };
    service.saveWorkspaceState({ ...state(), mossLayout });
    expect(service.getWorkspaceState()?.mossLayout).toEqual(mossLayout);

    expect(() =>
      service.saveWorkspaceState({
        ...state(),
        mossLayout: { ...mossLayout, canvas: { width: 0, height: 1024 } },
      }),
    ).toThrow("canvas sides");
    expect(() =>
      service.saveWorkspaceState({
        ...state(),
        mossLayout: {
          ...mossLayout,
          boxes: [{ ...mossLayout.boxes[0], bbox: [300, 20, 10, 400] as [number, number, number, number] }],
        },
      }),
    ).toThrow("top < bottom");
    expect(() =>
      service.saveWorkspaceState({
        ...state(),
        mossLayout: {
          ...mossLayout,
          boxes: Array.from({ length: 33 }, (_, index) => ({
            ...mossLayout.boxes[1],
            id: `box-${index}`,
          })),
        },
      }),
    ).toThrow("at most 32 boxes");
  });

  it("drops a damaged stored canvas but keeps the rest of the workspace", () => {
    rawDb
      .prepare(
        "INSERT INTO prompt_orchestrator_state (id, state_json, updated_at) VALUES ('default', ?, ?)",
      )
      .run(
        JSON.stringify({
          prefabTerms: [],
          modelId: "moss-base",
          loraIds: "",
          mossLayout: {
            version: 1,
            canvas: { width: 1024, height: 1024 },
            boxes: [{ id: "bad", label: "object", caption: "", bbox: [0, 0, 0, 0] }],
          },
        }),
        Date.now(),
      );
    const service = new DesktopPromptOrchestratorService(rawDb);
    const restored = service.getWorkspaceState();
    expect(restored?.modelId).toBe("moss-base");
    expect(restored?.mossLayout).toBeUndefined();
  });
});