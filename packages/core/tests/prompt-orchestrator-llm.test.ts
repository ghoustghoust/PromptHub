import { describe, expect, it } from "vitest";
import type { AITransportRequest, AITransportResponse } from "@prompthub/shared/types";
import {
  OpenAiCompatiblePromptLlm,
  type PromptLlmMessage,
  type PromptLlmTool,
} from "../src/prompt-orchestrator-llm";

const TOOLS: PromptLlmTool[] = [
  {
    type: "function",
    function: {
      name: "search_vocabulary",
      description: "search",
      parameters: { type: "object", properties: {} },
    },
  },
];

function response(body: unknown): AITransportResponse {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: {},
    body: JSON.stringify(body),
  };
}

function completion(content: string | null, toolCalls?: unknown[], finish = "stop"): unknown {
  return {
    choices: [
      {
        index: 0,
        finish_reason: finish,
        message: {
          role: "assistant",
          content,
          ...(toolCalls ? { tool_calls: toolCalls } : {}),
        },
      },
    ],
  };
}

describe("OpenAiCompatiblePromptLlm tool calling", () => {
  it("sends tools and round-trips assistant tool calls with their results", async () => {
    const requests: AITransportRequest[] = [];
    const transport = async (request: AITransportRequest): Promise<AITransportResponse> => {
      requests.push(request);
      return response(
        completion(null, [
          {
            id: "call_1",
            type: "function",
            function: { name: "search_vocabulary", arguments: "{\"queries\":[]}" },
          },
        ]),
      );
    };
    const llm = new OpenAiCompatiblePromptLlm(
      { endpoint: "http://127.0.0.1:9/v1", model: "local" },
      transport,
    );
    const messages: PromptLlmMessage[] = [
      { role: "system", content: "system" },
      { role: "user", content: "user" },
      {
        role: "assistant",
        content: null,
        toolCalls: [{ id: "call_0", name: "search_vocabulary", arguments: "{}" }],
      },
      { role: "tool", toolCallId: "call_0", content: "{\"groups\":[]}" },
    ];
    const result = await llm.completeWithTools({
      messages,
      tools: TOOLS,
      mode: "expand",
    });

    expect(result.toolCalls).toEqual([
      { id: "call_1", name: "search_vocabulary", arguments: "{\"queries\":[]}" },
    ]);
    const sent = JSON.parse(requests[0].body ?? "{}") as {
      tools: unknown[];
      tool_choice: string;
      messages: Array<Record<string, unknown>>;
    };
    expect(sent.tools).toEqual(TOOLS);
    expect(sent.tool_choice).toBe("auto");
    expect(sent.messages[2]).toMatchObject({
      role: "assistant",
      content: null,
      tool_calls: [
        { id: "call_0", type: "function", function: { name: "search_vocabulary", arguments: "{}" } },
      ],
    });
    expect(sent.messages[3]).toMatchObject({
      role: "tool",
      tool_call_id: "call_0",
      content: "{\"groups\":[]}",
    });
  });

  it("returns content when the model stops calling tools", async () => {
    const transport = async (): Promise<AITransportResponse> =>
      response(completion("{\"initialPrompt\":\"x\"}"));
    const llm = new OpenAiCompatiblePromptLlm(
      { endpoint: "http://127.0.0.1:9/v1", model: "local" },
      transport,
    );
    const result = await llm.completeWithTools({
      messages: [{ role: "user", content: "user" }],
      tools: TOOLS,
      mode: "expand",
      toolChoice: "none",
    });
    expect(result.content).toContain("initialPrompt");
    expect(result.toolCalls).toEqual([]);
  });

  it("attaches images only to the first user message", async () => {
    const requests: AITransportRequest[] = [];
    const transport = async (request: AITransportRequest): Promise<AITransportResponse> => {
      requests.push(request);
      return response(completion("ok"));
    };
    const llm = new OpenAiCompatiblePromptLlm(
      { endpoint: "http://127.0.0.1:9/v1", model: "local" },
      transport,
    );
    await llm.completeWithTools({
      messages: [
        { role: "system", content: "system" },
        { role: "user", content: "look" },
        { role: "tool", toolCallId: "c1", content: "{}" },
      ],
      tools: TOOLS,
      mode: "reverse",
      imageUrls: ["https://example.com/a.png"],
    });
    const sent = JSON.parse(requests[0].body ?? "{}") as {
      messages: Array<{ role: string; content: unknown }>;
    };
    const user = sent.messages.find((message) => message.role === "user");
    expect(Array.isArray(user?.content)).toBe(true);
    const tool = sent.messages.find((message) => message.role === "tool");
    expect(typeof tool?.content).toBe("string");
  });

  it("rejects truncated tool responses", async () => {
    const transport = async (): Promise<AITransportResponse> =>
      response(completion(null, [{ id: "c", type: "function", function: { name: "x", arguments: "{}" } }], "length"));
    const llm = new OpenAiCompatiblePromptLlm(
      { endpoint: "http://127.0.0.1:9/v1", model: "local" },
      transport,
    );
    await expect(
      llm.completeWithTools({
        messages: [{ role: "user", content: "user" }],
        tools: TOOLS,
        mode: "expand",
      }),
    ).rejects.toThrow("truncated");
  });
});