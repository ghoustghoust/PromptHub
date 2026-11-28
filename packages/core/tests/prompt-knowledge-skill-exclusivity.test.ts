import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DatabaseAdapter,
  PromptVocabDB,
  SCHEMA_INDEXES,
  SCHEMA_TABLES,
} from "@prompthub/db";
import type { PromptKnowledgeModuleSelection } from "@prompthub/shared/types";
import { PromptOrchestrator } from "../src/prompt-orchestrator";
import type { PromptOrchestratorLlm } from "../src/prompt-orchestrator-llm";

let database: DatabaseAdapter.Database;
let vocabulary: PromptVocabDB;

beforeEach(() => {
  database = new DatabaseAdapter(":memory:");
  database.exec(SCHEMA_TABLES);
  database.exec(SCHEMA_INDEXES);
  vocabulary = new PromptVocabDB(database);
});

afterEach(() => database.close());

function llm(): PromptOrchestratorLlm {
  return {
    complete: async () =>
      JSON.stringify({
        initialPrompt: "core",
        completePrompt: "A reader by a tall window",
        fields: [],
      }),
  };
}

function contractModule(
  overrides: Partial<PromptKnowledgeModuleSelection> & { id: string },
): PromptKnowledgeModuleSelection {
  return {
    packId: "pack-a",
    packName: "Script pack A",
    moduleKey: `k-${overrides.id}`,
    title: "Script contract",
    role: "contract",
    contractGroups: ["script"],
    content: "Write the script in three acts.",
    ...overrides,
  };
}

describe("one primary skill per contract group", () => {
  it("rejects two packs that both own the script contract", async () => {
    const orchestrator = new PromptOrchestrator({ vocabulary, llm: llm() });
    await expect(
      orchestrator.orchestrate({
        prompt: "A short film about a courier",
        mode: "expand",
        skill: "moss",
        outputFormat: "caption",
        knowledgeModules: [
          contractModule({ id: "a", packId: "pack-a", packName: "Script pack A" }),
          contractModule({ id: "b", packId: "pack-b", packName: "Script pack B" }),
        ],
      }),
    ).rejects.toThrow(/script/i);
  });

  it("allows several contract modules from the same pack", async () => {
    const result = await new PromptOrchestrator({ vocabulary, llm: llm() }).orchestrate({
      prompt: "A short film about a courier",
      mode: "expand",
      skill: "moss",
      outputFormat: "caption",
      knowledgeModules: [
        contractModule({ id: "a1", packId: "pack-a", moduleKey: "k-1" }),
        contractModule({ id: "a2", packId: "pack-a", moduleKey: "k-2" }),
      ],
    });
    expect(result.status).toBe("complete");
  });

  it("allows different groups because they serve different steps", async () => {
    const result = await new PromptOrchestrator({ vocabulary, llm: llm() }).orchestrate({
      prompt: "A short film about a courier",
      mode: "expand",
      skill: "moss",
      outputFormat: "caption",
      knowledgeModules: [
        contractModule({ id: "s", packId: "pack-script", contractGroups: ["script"] }),
        contractModule({ id: "b", packId: "pack-board", contractGroups: ["storyboard"] }),
      ],
    });
    expect(result.status).toBe("complete");
  });

  it("keeps ordinary knowledge modules free of the conflict rule", async () => {
    const result = await new PromptOrchestrator({ vocabulary, llm: llm() }).orchestrate({
      prompt: "A short film about a courier",
      mode: "expand",
      skill: "moss",
      outputFormat: "caption",
      knowledgeModules: [
        contractModule({ id: "a", packId: "pack-a" }),
        contractModule({
          id: "k1",
          packId: "pack-b",
          role: "knowledge",
          contractGroups: [],
        }),
      ],
    });
    expect(result.status).toBe("complete");
  });
});