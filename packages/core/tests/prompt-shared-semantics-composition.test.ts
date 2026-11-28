import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DatabaseAdapter,
  PromptVocabDB,
  SCHEMA_INDEXES,
  SCHEMA_TABLES,
} from "@prompthub/db";
import type { PromptOrchestrationInput } from "@prompthub/shared/types";
import { PromptOrchestrator } from "../src/prompt-orchestrator";
import type { PromptOrchestratorLlm } from "../src/prompt-orchestrator-llm";
import { compileSharedSemantics } from "../src/prompt-model-compiler";

let database: DatabaseAdapter.Database;
let vocabulary: PromptVocabDB;

beforeEach(() => {
  database = new DatabaseAdapter(":memory:");
  database.exec(SCHEMA_TABLES);
  database.exec(SCHEMA_INDEXES);
  vocabulary = new PromptVocabDB(database);
});

afterEach(() => database.close());

const FACTS = {
  subject: "a courier under a street lamp",
  setting: "a narrow street after midnight",
  lighting: "one warm practical on wet asphalt",
  continuity: "same coat and envelope as the previous shot",
};

async function systemFor(overrides: Partial<PromptOrchestrationInput>): Promise<string> {
  let system = "";
  const llm: PromptOrchestratorLlm = {
    complete: async (request) => {
      system = request.messages.system;
      return JSON.stringify({
        initialPrompt: "core",
        completePrompt: "A courier under a street lamp",
        fields: [],
      });
    },
  };
  await new PromptOrchestrator({ vocabulary, llm }).orchestrate({
    prompt: "A courier waits under a street lamp",
    mode: "expand",
    outputFormat: "caption",
    guidanceMode: "human-led",
    sharedSemantics: FACTS,
    ...overrides,
  });
  return system;
}

function sharedBlock(system: string): string {
  const start = system.indexOf("Shared scene facts");
  const end = system.indexOf("rule card", start);
  return system.slice(start, end > start ? end : undefined);
}

describe("shared semantics in the composed system prompt", () => {
  it("emits the shared block once and keeps it identical across models", async () => {
    const moss = await systemFor({ skill: "moss" });
    const k2 = await systemFor({ skill: "k2" });

    expect(moss).toContain("Shared scene facts");
    expect(moss.split("Shared scene facts").length - 1).toBe(1);
    expect(k2.split("Shared scene facts").length - 1).toBe(1);
    const shared = compileSharedSemantics(FACTS);
    expect(moss.split(shared).length - 1).toBe(1);
    expect(k2.split(shared).length - 1).toBe(1);
    expect(moss).toContain("MOSS-Image native rule card");
    expect(k2).toContain("Krea 2 / K2");
  });

  it("leaves the system unchanged when no shared facts are supplied", async () => {
    const plain = await systemFor({ skill: "moss", sharedSemantics: undefined });
    expect(plain).not.toContain("Shared scene facts");
    expect(plain).toContain("MOSS-Image native rule card");
  });
});