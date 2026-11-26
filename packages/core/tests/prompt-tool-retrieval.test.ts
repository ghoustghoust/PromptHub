import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DatabaseAdapter,
  PromptVocabDB,
  SCHEMA_INDEXES,
  SCHEMA_TABLES,
} from "@prompthub/db";
import { deriveEntityAliases } from "@prompthub/shared/utils/prompt-entity-key";
import { PromptOrchestrator } from "../src/prompt-orchestrator";
import type {
  PromptLlmToolRequest,
  PromptOrchestratorLlm,
} from "../src/prompt-orchestrator-llm";
import { RESOLVE_VOCABULARY_TOOL, SEARCH_VOCABULARY_TOOL } from "../src/prompt-vocabulary-tools";
import type { PromptOrchestrationInput } from "@prompthub/shared/types";

let database: DatabaseAdapter.Database;
let vocabulary: PromptVocabDB;

interface ToolCallStep {
  name: string;
  arguments: Record<string, unknown>;
}

interface ToolStep {
  content?: string;
  toolCalls?: ToolCallStep[];
  error?: Error;
}

const CREATED_AT = "2026-11-22T00:00:00.000Z";

function addTerm(id: string, category: string, en: string, extra: Record<string, unknown> = {}): void {
  vocabulary.addTerm({
    id,
    category,
    en,
    validationStatus: "validated",
    createdAt: CREATED_AT,
    ...extra,
  });
}

function seedCharacter(id: string, en: string, zh: string | null): void {
  addTerm(id, "character", en, { zh, subcategory: "原神", domain: "anime" });
  vocabulary.addTermAliases(
    deriveEntityAliases({ en, zh }).map((alias) => ({
      termId: id,
      alias: alias.alias,
      kind: alias.kind,
    })),
  );
}

beforeEach(() => {
  database = new DatabaseAdapter(":memory:");
  database.exec(SCHEMA_TABLES);
  database.exec(SCHEMA_INDEXES);
  vocabulary = new PromptVocabDB(database);
  addTerm("light-1", "lighting", "soft light");
  addTerm("light-2", "lighting", "golden hour");
  addTerm("cam-1", "camera", "85mm lens");
  addTerm("artist-1", "artist", "@wlop", { subcategory: "厚涂/半厚涂", domain: "anime" });
  addTerm("nsfw-1", "nsfw", "explicit pose");
  seedCharacter("char-gen", "ganyu (genshin impact)", "甘雨（原神）");
});

afterEach(() => database.close());

function decision(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    slotId: "lighting",
    category: "lighting",
    sourceText: "soft light",
    strategy: "reuse",
    termIds: ["light-1"],
    output: "soft light",
    rationale: "matched the requested light",
    ...overrides,
  };
}

function finalJson(decisions: Record<string, unknown>[] = [decision()]): string {
  return JSON.stringify({
    initialPrompt: "source",
    completePrompt: "ganyu (genshin impact) in soft light",
    fields: [],
    termDecisions: decisions,
  });
}

function scriptedLlm(script: ToolStep[], fallback = finalJson()): {
  llm: PromptOrchestratorLlm;
  requests: PromptLlmToolRequest[];
} {
  const requests: PromptLlmToolRequest[] = [];
  const llm: PromptOrchestratorLlm = {
    complete: async () => fallback,
    completeWithTools: async (request) => {
      requests.push(request);
      const step = script.shift();
      if (!step) throw new Error("tool script exhausted");
      if (step.error) throw step.error;
      return {
        content: step.content ?? "",
        toolCalls: (step.toolCalls ?? []).map((call, index) => ({
          id: `call_${requests.length}_${index}`,
          name: call.name,
          arguments: JSON.stringify(call.arguments),
        })),
      };
    },
  };
  return { llm, requests };
}

function input(overrides: Partial<PromptOrchestrationInput> = {}): PromptOrchestrationInput {
  return {
    prompt: "ganyu (genshin impact) in a quiet room",
    mode: "expand",
    outputFormat: "caption",
    vocabularyTokenBudget: 900,
    ...overrides,
  };
}

function toolContents(request: PromptLlmToolRequest): Array<Record<string, unknown>> {
  return request.messages
    .filter((message) => message.role === "tool")
    .map((message) => JSON.parse(message.content ?? "{}") as Record<string, unknown>);
}

describe("tool-assisted retrieval", () => {
  it("runs search and identity tools in one model-controlled loop", async () => {
    const { llm, requests } = scriptedLlm([
      {
        toolCalls: [
          { name: SEARCH_VOCABULARY_TOOL, arguments: { queries: [{ slotId: "lighting", category: "lighting", query: "soft light" }] } },
        ],
      },
      {
        toolCalls: [
          { name: RESOLVE_VOCABULARY_TOOL, arguments: { terms: ["ganyu (genshin impact)"] } },
        ],
      },
      { content: finalJson() },
    ]);
    const result = await new PromptOrchestrator({ vocabulary, llm }).orchestrate(input());

    expect(result.status).toBe("complete");
    expect(requests).toHaveLength(3);
    expect(requests[0].tools.map((tool) => tool.function.name)).toEqual([
      RESOLVE_VOCABULARY_TOOL,
      SEARCH_VOCABULARY_TOOL,
    ]);
    expect(String(requests[0].messages[0].content)).toContain(
      "Tool-assisted knowledge contract",
    );

    const searchResult = toolContents(requests[1])[0] as {
      groups: Array<{ slotId: string; status: string; candidates: Array<{ id: string }> }>;
    };
    expect(searchResult.groups[0].status).toBe("match");
    expect(searchResult.groups[0].candidates.map((candidate) => candidate.id)).toContain("light-1");

    const resolveResult = toolContents(requests[2]).at(-1) as {
      results: Array<{ term: string; status: string; identity: { termIds: string[] } }>;
    };
    expect(resolveResult.results[0].status).toBe("resolved");
    expect(resolveResult.results[0].identity.termIds).toContain("char-gen");

    expect(result.retrievalSummary).toMatchObject({ rounds: 2, queryCount: 1 });
    expect(result.termDecisions?.[0].strategy).toBe("reuse");
    expect(result.termDecisions?.[0].origin).toBe("model");
    expect(result.provenance?.some((entry) => entry.termId === "light-1")).toBe(true);
    expect(result.termDecisions?.[0].terms.map((term) => term.id)).toEqual(["light-1"]);
    expect(result.selectedTerms.map((term) => term.id)).toContain("light-1");

    expect(result.retrievalTrace?.searches).toHaveLength(1);
    expect(result.retrievalTrace?.searches[0]).toMatchObject({
      round: 1,
      origin: "model",
      slotId: "lighting",
      query: "soft light",
      purpose: "compare",
      depth: "focused",
      status: "match",
    });
    expect(result.retrievalTrace?.searches[0].candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "light-1", status: "presented" }),
      ]),
    );
    expect(result.retrievalTrace?.identities).toHaveLength(1);
    expect(result.retrievalTrace?.identities[0]).toMatchObject({
      round: 2,
      term: "ganyu (genshin impact)",
      status: "resolved",
    });
  });

  it("uses tools for polish and text-only reverse, but not for reverse with images", async () => {
    const polish = scriptedLlm([{ content: finalJson() }]);
    const polished = await new PromptOrchestrator({ vocabulary, llm: polish.llm }).orchestrate(
      input({ mode: "polish" }),
    );
    expect(polished.status).toBe("complete");
    expect(polish.requests).toHaveLength(1);
    expect(polish.requests[0].maxTokens).toBe(2048);
    expect(String(polish.requests[0].messages[0].content)).toContain(
      "Tool-assisted knowledge contract",
    );

    const textReverse = scriptedLlm([{ content: finalJson() }]);
    const textReversed = await new PromptOrchestrator({ vocabulary, llm: textReverse.llm }).orchestrate(
      input({ mode: "reverse", prompt: "reverse this description" }),
    );
    expect(textReversed.status).toBe("complete");
    expect(textReverse.requests).toHaveLength(1);

    const imageReverse = scriptedLlm([{ content: finalJson() }]);
    const reversed = await new PromptOrchestrator({ vocabulary, llm: imageReverse.llm }).orchestrate(
      input({
        mode: "reverse",
        prompt: "reverse this frame",
        imageUrls: ["https://example.com/a.png", "https://example.com/b.png"],
      }),
    );
    expect(reversed.status).toBe("complete");
    // Vision-heavy reverse stays single-shot; the tool loop would double a
    // multi-thousand-token prompt.
    expect(imageReverse.requests).toHaveLength(0);
  });

  it("rejects identity categories in search and keeps the loop alive", async () => {
    const { llm, requests } = scriptedLlm([
      {
        toolCalls: [
          { name: SEARCH_VOCABULARY_TOOL, arguments: { queries: [{ slotId: "who", category: "artist", query: "wlop" }] } },
        ],
      },
      { content: finalJson([decision({ termIds: [], strategy: "create" })]) },
    ]);
    const result = await new PromptOrchestrator({ vocabulary, llm }).orchestrate(input());
    const group = (toolContents(requests[1])[0] as {
      groups: Array<{ status: string; candidates: unknown[] }>;
    }).groups[0];
    expect(group.status).toBe("forbidden");
    expect(group.candidates).toEqual([]);
    expect(result.warnings.join(" ")).toContain("forbidden category");
    expect(result.status).toBe("complete");
  });

  it("honours avoid and does not repeat rows across calls", async () => {
    const { llm, requests } = scriptedLlm([
      {
        toolCalls: [
          { name: SEARCH_VOCABULARY_TOOL, arguments: { queries: [{ slotId: "lighting", category: "lighting", query: "light" }] } },
        ],
      },
      {
        toolCalls: [
          {
            name: SEARCH_VOCABULARY_TOOL,
            arguments: { queries: [{ slotId: "lighting-2", category: "lighting", query: "light", avoid: ["light-1"] }] },
          },
        ],
      },
      { content: finalJson([decision()]) },
    ]);
    const result = await new PromptOrchestrator({ vocabulary, llm }).orchestrate(input());
    const second = toolContents(requests[2]).at(-1) as {
      groups: Array<{ excludedByAvoid: Array<{ id: string }>; duplicates: Array<{ id: string }>; candidates: Array<{ id: string }> }>;
    };
    expect(second.groups[0].excludedByAvoid.map((row) => row.id)).toContain("light-1");
    expect(second.groups[0].candidates.map((row) => row.id)).not.toContain("light-1");
    expect(result.retrievalTrace?.searches[1].candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "light-1", status: "avoid" }),
        expect.objectContaining({ id: "light-2", status: "duplicate" }),
      ]),
    );
  });

  it("returns budget_exceeded instead of silently dropping the budget rule", async () => {
    const { llm, requests } = scriptedLlm([
      {
        toolCalls: [
          { name: SEARCH_VOCABULARY_TOOL, arguments: { queries: [{ slotId: "lighting", category: "lighting", query: "soft light" }] } },
        ],
      },
      { content: finalJson([decision({ termIds: [], strategy: "create" })]) },
    ]);
    await new PromptOrchestrator({ vocabulary, llm }).orchestrate(
      input({ vocabularyTokenBudget: 0 }),
    );
    const group = (toolContents(requests[1])[0] as {
      groups: Array<{ status: string; candidates: unknown[] }>;
    }).groups[0];
    expect(group.status).toBe("budget_exceeded");
    expect(group.candidates).toEqual([]);
  });

  it("forces the final answer once the tool-call budget is spent", async () => {
    const repeated = Array.from({ length: 4 }, () => ({
      name: SEARCH_VOCABULARY_TOOL,
      arguments: { queries: [{ slotId: "lighting", category: "lighting", query: "light" }] },
    }));
    const { llm, requests } = scriptedLlm([
      { toolCalls: repeated.slice(0, 4) },
      { toolCalls: repeated.slice(0, 2) },
      { content: finalJson([decision({ termIds: [], strategy: "create" })]) },
    ]);
    const result = await new PromptOrchestrator({ vocabulary, llm }).orchestrate(input());
    expect(requests[2].toolChoice).toBe("none");
    expect(result.warnings.join(" ")).toContain("Tool retrieval stopped");
    expect(result.status).toBe("complete");
  });

  it("reports malformed tool arguments without breaking the conversation", async () => {
    const requests: PromptLlmToolRequest[] = [];
    const llm: PromptOrchestratorLlm = {
      complete: async () => finalJson([decision({ termIds: [], strategy: "create" })]),
      completeWithTools: async (request) => {
        requests.push(request);
        if (requests.length === 1) {
          return {
            content: "",
            toolCalls: [{ id: "bad-1", name: SEARCH_VOCABULARY_TOOL, arguments: "{not json" }],
          };
        }
        return { content: finalJson([decision({ termIds: [], strategy: "create" })]), toolCalls: [] };
      },
    };
    const result = await new PromptOrchestrator({ vocabulary, llm }).orchestrate(input());
    const toolMessage = requests[1].messages.find((message) => message.role === "tool");
    expect(toolMessage?.content).toContain("invalid_arguments");
    expect(result.status).toBe("complete");
  });

  it("falls back to the former path when tool calling fails", async () => {
    const { llm, requests } = scriptedLlm([
      {
        toolCalls: [
          { name: SEARCH_VOCABULARY_TOOL, arguments: { queries: [{ slotId: "lighting", category: "lighting", query: "soft light" }] } },
        ],
      },
      { error: new Error("tools are not supported") },
    ]);
    const result = await new PromptOrchestrator({ vocabulary, llm }).orchestrate(input());
    expect(requests).toHaveLength(2);
    expect(result.status).toBe("complete");
    expect(result.warnings.join(" ")).toContain("Tool retrieval failed");
    expect(result.termDecisions?.some((decision) => decision.origin === "model")).toBe(false);
    expect(result.retrievalTrace?.searches).toHaveLength(1);
    expect(result.retrievalTrace?.fallbacks).toEqual([
      expect.objectContaining({
        from: "tool-retrieval",
        to: "plain-composition",
        reason: "tools are not supported",
      }),
    ]);
  });

  it("allows a final answer without any tool call", async () => {
    const { llm } = scriptedLlm([{ content: finalJson([decision({ termIds: [], strategy: "create" })]) }]);
    const result = await new PromptOrchestrator({ vocabulary, llm }).orchestrate(input());
    expect(result.status).toBe("complete");
    expect(result.retrievalSummary).toEqual({ rounds: 0, queryCount: 0, candidateCount: 0 });
  });

  it("accepts zero decisions when the model legitimately makes no retrieval", async () => {
    const { llm } = scriptedLlm([{ content: finalJson([]) }]);
    const result = await new PromptOrchestrator({ vocabulary, llm }).orchestrate(input());
    expect(result.status).toBe("complete");
    expect(result.termDecisions).toEqual([]);
    expect(result.retrievalSummary).toEqual({ rounds: 0, queryCount: 0, candidateCount: 0 });
  });
});