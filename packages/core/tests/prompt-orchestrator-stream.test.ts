import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { PromptOrchestratorStreamEvent } from "@prompthub/shared/types";
import {
  OpenAiCompatiblePromptLlm,
  type PromptLlmStreamStats,
} from "../src/prompt-orchestrator-llm";
import { createStreamCallbacks } from "../src/prompt-orchestrator-stream";

let server: http.Server | null = null;

afterEach(async () => {
  if (!server) return;
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = null;
});

async function listen(handler: http.RequestListener): Promise<string> {
  server = http.createServer(handler);
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}/v1`;
}

function sse(chunks: unknown[]): string {
  return chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n";
}

describe("streaming completions", () => {
  it("streams deltas and reports provider usage", async () => {
    let receivedBody: Record<string, unknown> | null = null;
    const endpoint = await listen((request, response) => {
      let raw = "";
      request.on("data", (chunk) => {
        raw += chunk;
      });
      request.on("end", () => {
        receivedBody = JSON.parse(raw) as Record<string, unknown>;
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.end(
          sse([
            { choices: [{ index: 0, delta: { content: '{"initialPrompt":"a"' } }] },
            { choices: [{ index: 0, delta: { content: ',"completePrompt":"a portrait"}' } }] },
            {
              choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
              usage: { prompt_tokens: 120, completion_tokens: 9 },
            },
          ]),
        );
      });
    });

    const llm = new OpenAiCompatiblePromptLlm({ endpoint, model: "local" });
    const deltas: string[] = [];
    const stats: PromptLlmStreamStats[] = [];
    const modes: string[] = [];
    const content = await llm.complete({
      messages: { system: "system", user: "user" },
      mode: "expand",
      stream: {
        onDelta: (delta) => deltas.push(delta),
        onStats: (value) => stats.push(value),
        onMode: (mode) => modes.push(mode),
      },
    });

    expect(content).toBe('{"initialPrompt":"a","completePrompt":"a portrait"}');
    expect(deltas).toEqual(['{"initialPrompt":"a"', ',"completePrompt":"a portrait"}']);
    expect(modes).toEqual(["stream"]);
    expect(receivedBody).toMatchObject({
      stream: true,
      stream_options: { include_usage: true },
      response_format: { type: "json_object" },
    });
    expect(stats.at(-1)).toMatchObject({
      mode: "stream",
      completionTokens: 9,
      source: "provider",
    });
    expect(stats.at(-1)?.firstTokenMs).toBeGreaterThanOrEqual(0);
  });

  it("falls back to a buffered request when the endpoint rejects streaming", async () => {
    let calls = 0;
    const endpoint = await listen((request, response) => {
      let raw = "";
      request.on("data", (chunk) => {
        raw += chunk;
      });
      request.on("end", () => {
        calls += 1;
        const body = JSON.parse(raw) as { stream?: boolean };
        if (body.stream) {
          response.writeHead(400, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: { message: "stream is not supported" } }));
          return;
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            choices: [
              {
                index: 0,
                finish_reason: "stop",
                message: { role: "assistant", content: '{"completePrompt":"buffered"}' },
              },
            ],
          }),
        );
      });
    });

    const llm = new OpenAiCompatiblePromptLlm({ endpoint, model: "local" });
    const modes: string[] = [];
    const stats: PromptLlmStreamStats[] = [];
    const content = await llm.complete({
      messages: { system: "system", user: "user" },
      mode: "expand",
      stream: {
        onDelta: () => undefined,
        onMode: (mode) => modes.push(mode),
        onStats: (value) => stats.push(value),
      },
    });

    expect(calls).toBe(2);
    expect(content).toBe('{"completePrompt":"buffered"}');
    expect(modes).toEqual(["buffered"]);
    expect(stats.at(-1)).toMatchObject({ mode: "buffered", source: "estimate" });
  });

  it("only streams the final tool turn, never a tool-call turn", async () => {
    const streamFlags: boolean[] = [];
    const endpoint = await listen((request, response) => {
      let raw = "";
      request.on("data", (chunk) => {
        raw += chunk;
      });
      request.on("end", () => {
        const body = JSON.parse(raw) as { stream?: boolean };
        streamFlags.push(body.stream === true);
        if (body.stream) {
          response.writeHead(200, { "content-type": "text/event-stream" });
          response.end(sse([{ choices: [{ index: 0, delta: { content: "final" } }] }]));
          return;
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            choices: [
              { index: 0, finish_reason: "stop", message: { role: "assistant", content: "final" } },
            ],
          }),
        );
      });
    });

    const llm = new OpenAiCompatiblePromptLlm({ endpoint, model: "local" });
    const messages = [
      { role: "system" as const, content: "system" },
      { role: "user" as const, content: "user" },
    ];
    const tools = [
      {
        type: "function" as const,
        function: { name: "search", description: "search", parameters: { type: "object" } },
      },
    ];
    await llm.completeWithTools({
      messages,
      tools,
      mode: "expand",
      toolChoice: "auto",
      stream: { onDelta: () => undefined },
    });
    await llm.completeWithTools({
      messages,
      tools,
      mode: "expand",
      toolChoice: "none",
      stream: { onDelta: () => undefined },
    });
    expect(streamFlags).toEqual([false, true]);
  });
});

describe("stream structure tracking", () => {
  it("reports which top-level keys have appeared without inventing progress", () => {
    const events: PromptOrchestratorStreamEvent[] = [];
    const callbacks = createStreamCallbacks((event) => events.push(event));
    callbacks?.onDelta?.('{"initialPrompt":"a",');
    callbacks?.onDelta?.('"completePrompt":"b",');
    callbacks?.onDelta?.('"fields":[]}');
    const structure = events.filter((event) => event.type === "structure");
    expect(structure.map((event) => (event.type === "structure" ? event.percent : 0))).toEqual([
      20, 40, 60,
    ]);
    expect(
      structure.at(-1)?.type === "structure" ? structure.at(-1)?.fields : [],
    ).toEqual(["initialPrompt", "completePrompt", "fields"]);
  });
});
