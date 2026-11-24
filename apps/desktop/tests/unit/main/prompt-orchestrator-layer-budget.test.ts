import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SCHEMA_TABLES } from "@prompthub/db";
import DatabaseAdapter from "../../../src/main/database/sqlite";
import { DesktopPromptOrchestratorService } from "../../../src/main/services/prompt-orchestrator-service";

let rawDb: DatabaseAdapter.Database;
let service: DesktopPromptOrchestratorService;

beforeEach(() => {
  rawDb = new DatabaseAdapter(":memory:");
  rawDb.pragma("foreign_keys = ON");
  rawDb.exec(SCHEMA_TABLES);
  service = new DesktopPromptOrchestratorService(rawDb);
});

afterEach(() => rawDb.close());

describe("layer budget preview", () => {
  it("returns the same fixed costs the orchestrator enforces", () => {
    const preview = service.getLayerBudget({
      skill: "moss",
      mode: "expand",
      outputFormat: "caption",
      contextTokens: 8192,
      vocabularyTokenBudget: 900,
    });
    expect(preview.contextTokens).toBe(8192);
    expect(preview.outputReserveTokens).toBe(4096);
    expect(preview.contractTokens).toBeGreaterThan(300);
    expect(preview.budgetTokens).toBeGreaterThan(0);
    expect(
      preview.budgetTokens +
        preview.outputReserveTokens +
        preview.contractTokens +
        preview.inputTokens +
        preview.vocabularyTokens +
        preview.imageTokens +
        preview.safetyTokens,
    ).toBe(8192);
  });

  it("scales with the declared context and rejects invalid values", () => {
    const small = service.getLayerBudget({ contextTokens: 8192 });
    const large = service.getLayerBudget({ contextTokens: 32_768 });
    expect(large.budgetTokens).toBeGreaterThan(small.budgetTokens);
    expect(() => service.getLayerBudget({ contextTokens: 1024 })).toThrow("contextTokens");
    expect(() => service.getLayerBudget({ outputReserveTokens: 1 })).toThrow(
      "outputReserveTokens",
    );
    expect(() => service.getLayerBudget({ skill: "sdxl" })).toThrow("Unsupported prompt rule skill");
    expect(() => service.getLayerBudget({ imageCount: 9 })).toThrow("imageCount");
  });
});
