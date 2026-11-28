import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SCHEMA_TABLES } from "@prompthub/db";
import DatabaseAdapter from "../../../src/main/database/sqlite";
import { DesktopPromptOrchestratorService } from "../../../src/main/services/prompt-orchestrator-service";

let rawDb: DatabaseAdapter.Database;

beforeEach(() => {
  rawDb = new DatabaseAdapter(":memory:");
  rawDb.pragma("foreign_keys = ON");
  rawDb.exec(SCHEMA_TABLES);
});

afterEach(() => rawDb.close());

const outline = {
  version: 1,
  text: "A courier crosses the wet market street.",
  createdAt: "2026-11-27T08:00:00.000Z",
};

describe("script flow persistence", () => {
  it("returns null before the first save", () => {
    const service = new DesktopPromptOrchestratorService(rawDb);
    expect(service.getScriptFlow()).toBeNull();
  });

  it("round-trips stages, versions and basedOn", () => {
    const service = new DesktopPromptOrchestratorService(rawDb);
    const saved = service.saveScriptFlow({
      versions: {
        outline: [outline],
        script: [
          {
            version: 1,
            text: "INT. STREET - NIGHT",
            createdAt: "2026-11-27T08:05:00.000Z",
            basedOn: { outline: 1 },
          },
        ],
        storyboard: [],
        unit: [],
      },
    });
    expect(saved.versions.script[0].basedOn).toEqual({ outline: 1 });
    expect(service.getScriptFlow()).toMatchObject({
      versions: {
        outline: [{ version: 1, text: "A courier crosses the wet market street." }],
        script: [{ basedOn: { outline: 1 } },],
      },
    });
  });

  it("replaces the single row instead of appending", () => {
    const service = new DesktopPromptOrchestratorService(rawDb);
    service.saveScriptFlow({ versions: { outline: [outline] } });
    service.saveScriptFlow({
      versions: {
        outline: [{ ...outline, version: 2, text: "revised outline" }],
      },
    });
    expect(service.getScriptFlow()?.versions.outline).toHaveLength(1);
    expect(service.getScriptFlow()?.versions.outline[0].text).toBe("revised outline");
    const rows = rawDb.get("SELECT COUNT(*) AS count FROM prompt_script_flow") as {
      count: number;
    };
    expect(rows.count).toBe(1);
  });

  it("rejects values that are not a flow object", () => {
    const service = new DesktopPromptOrchestratorService(rawDb);
    expect(() => service.saveScriptFlow("flow")).toThrow("script flow");
    expect(() => service.saveScriptFlow({ versions: "none" })).toThrow("script flow");
    expect(service.getScriptFlow()).toBeNull();
  });

  it("drops a malformed version and keeps the rest", () => {
    const service = new DesktopPromptOrchestratorService(rawDb);
    service.saveScriptFlow({
      versions: {
        outline: [outline, { version: 0, text: "bad", createdAt: "2026-11-27T00:00:00.000Z" }],
      },
    });
    expect(service.getScriptFlow()?.versions.outline).toHaveLength(1);
  });

  it("treats a corrupted stored row as empty", () => {
    rawDb
      .prepare(
        "INSERT INTO prompt_script_flow (id, flow_json, updated_at) VALUES ('default', ?, ?)",
      )
      .run("{not json", Date.now());
    const service = new DesktopPromptOrchestratorService(rawDb);
    expect(service.getScriptFlow()).toBeNull();
  });
});