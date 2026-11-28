import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DatabaseAdapter,
  PromptVocabDB,
  SCHEMA_INDEXES,
  SCHEMA_TABLES,
} from "@prompthub/db";
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

const IMAGE = "data:image/jpeg;base64,AAAA";

describe("reverse mode without a text prompt", () => {
  it("uses a standard instruction so an image-only request can run", async () => {
    let user = "";
    const llm: PromptOrchestratorLlm = {
      complete: async (request) => {
        user = request.messages.user;
        return JSON.stringify({
          initialPrompt: "portrait of a woman",
          completePrompt: "A portrait of a woman with shoulder-length hair",
          fields: [],
        });
      },
    };
    const result = await new PromptOrchestrator({ vocabulary, llm }).orchestrate({
      mode: "reverse",
      skill: "moss",
      outputFormat: "caption",
      guidanceMode: "agent-led",
      imageUrls: [IMAGE],
    });

    expect(result.status).toBe("complete");
    expect(JSON.parse(user).intent).toBeTruthy();
    expect(result.warnings.join(" ")).toContain("standard reverse instruction");
  });

  it("keeps the user's own wording when it exists", async () => {
    let user = "";
    const llm: PromptOrchestratorLlm = {
      complete: async (request) => {
        user = request.messages.user;
        return JSON.stringify({
          initialPrompt: "core",
          completePrompt: "A quiet street at dusk",
          fields: [],
        });
      },
    };
    await new PromptOrchestrator({ vocabulary, llm }).orchestrate({
      prompt: "read the light in this photo",
      mode: "reverse",
      skill: "moss",
      outputFormat: "caption",
      guidanceMode: "agent-led",
      imageUrls: [IMAGE],
    });

    expect(JSON.parse(user).intent).toBe("read the light in this photo");
  });
});