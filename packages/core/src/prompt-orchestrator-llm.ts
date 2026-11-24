import type {
  AITransportRequest,
  AITransportResponse,
  PromptOrchestrationMode,
} from "@prompthub/shared/types";
import { AI_REQUEST_TIMEOUT_MS } from "@prompthub/shared/constants/ai";
import { estimatePromptTokens } from "@prompthub/shared/utils/prompt-token-estimate";
import type { PromptCompositionMessages } from "./prompt-orchestrator-composition";

export interface PromptLlmCompletionRequest {
  messages: PromptCompositionMessages;
  mode: PromptOrchestrationMode;
  imageUrls?: string[];
  /** Per-request output budget; layout JSON needs far more than a caption. */
  maxTokens?: number;
  /** When present, the final content is streamed through these callbacks. */
  stream?: PromptLlmStreamCallbacks;
}

export interface PromptLlmStreamStats {
  mode: "stream" | "buffered";
  firstTokenMs?: number;
  completionTokens?: number;
  tokensPerSecond?: number;
  source: "provider" | "estimate";
}

export interface PromptLlmStreamCallbacks {
  onDelta?: (delta: string) => void;
  /** Fires once when the attempt actually streams or silently falls back. */
  onMode?: (mode: "stream" | "buffered") => void;
  onStats?: (stats: PromptLlmStreamStats) => void;
}

export interface PromptOrchestratorLlm {
  complete(request: PromptLlmCompletionRequest): Promise<string>;
  countTokens?(text: string): Promise<number>;
  /**
   * Multi-turn tool calling. Optional: providers without tool support keep the
   * older single-shot path, and Core falls back instead of forcing a format the
   * endpoint cannot reliably produce.
   */
  completeWithTools?(request: PromptLlmToolRequest): Promise<PromptLlmToolResponse>;
}

export interface PromptLlmToolFunctionDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface PromptLlmTool {
  type: "function";
  function: PromptLlmToolFunctionDefinition;
}

export interface PromptLlmToolCall {
  id: string;
  name: string;
  /** Raw JSON string exactly as the provider returned it. */
  arguments: string;
}

export type PromptLlmRole = "system" | "user" | "assistant" | "tool";

export interface PromptLlmMessage {
  role: PromptLlmRole;
  content: string | null;
  toolCalls?: PromptLlmToolCall[];
  toolCallId?: string;
}

export interface PromptLlmToolRequest {
  messages: PromptLlmMessage[];
  tools: PromptLlmTool[];
  mode: PromptOrchestrationMode;
  /** Attached to the first user message only. */
  imageUrls?: string[];
  maxTokens?: number;
  toolChoice?: "auto" | "none";
  /** Streaming is only used on the final turn (no tool calls expected). */
  stream?: PromptLlmStreamCallbacks;
}

export interface PromptLlmToolResponse {
  content: string;
  toolCalls: PromptLlmToolCall[];
}

export interface OpenAiPromptLlmConfig {
  /** Full /v1/chat/completions URL, an OpenAI-compatible /v1 base, or server root. */
  endpoint: string;
  model: string;
  apiKey?: string;
  timeoutMs?: number;
  maxTokens?: number;
  /** Sends chat_template_kwargs.enable_thinking=false; defaults to true. */
  disableThinking?: boolean;
}

export type PromptLlmTransport = (
  request: AITransportRequest,
) => Promise<AITransportResponse>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveEndpoint(endpoint: string): string {
  let url: URL;
  try {
    url = new URL(endpoint.trim());
  } catch {
    throw new Error("Prompt LLM endpoint must be a valid absolute URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Prompt LLM endpoint must use HTTP or HTTPS");
  }
  const path = url.pathname.replace(/\/+$/, "");
  if (path.endsWith("/chat/completions")) {
    url.pathname = path;
  } else if (path.endsWith("/v1")) {
    url.pathname = `${path}/chat/completions`;
  } else if (!path) {
    url.pathname = "/v1/chat/completions";
  } else {
    url.pathname = `${path}/chat/completions`;
  }
  return url.toString();
}

function resolveTokenizeEndpoint(endpoint: string): string {
  const url = new URL(resolveEndpoint(endpoint));
  url.pathname = url.pathname.replace(/\/chat\/completions$/, "/tokenize");
  return url.toString();
}

async function requestWithFetch(
  request: AITransportRequest,
): Promise<AITransportResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    request.timeoutMs ?? AI_REQUEST_TIMEOUT_MS,
  );
  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: controller.signal,
    });
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      body: await response.text(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function providerError(response: AITransportResponse): string {
  const fallback = `Prompt LLM request failed (${response.status} ${response.statusText})`;
  try {
    const parsed: unknown = JSON.parse(response.body);
    if (!isRecord(parsed)) return fallback;
    const error = parsed.error;
    if (isRecord(error) && typeof error.message === "string") {
      return error.message;
    }
    return typeof parsed.message === "string" ? parsed.message : fallback;
  } catch {
    return fallback;
  }
}

function parseResponse(response: AITransportResponse): string {
  if (!response.ok) throw new Error(providerError(response));
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.body);
  } catch (error) {
    throw new Error(
      `Prompt LLM returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.choices)) {
    throw new Error("Prompt LLM response does not contain choices");
  }
  const choice: unknown = parsed.choices[0];
  if (!isRecord(choice)) throw new Error("Prompt LLM returned an empty choice");
  if (choice.finish_reason === "length") {
    throw new Error("Prompt LLM output was truncated; increase maxTokens or context size");
  }
  if (!isRecord(choice.message)) {
    throw new Error("Prompt LLM choice does not contain a message");
  }
  const content = choice.message.content;
  if (typeof content === "string" && content.trim()) return content;
  if (typeof choice.message.reasoning_content === "string") {
    throw new Error(
      "Prompt LLM returned reasoning instead of content; disable thinking on the local engine",
    );
  }
  throw new Error("Prompt LLM returned empty message content");
}

function parseToolCalls(message: Record<string, unknown>): PromptLlmToolCall[] {
  if (!Array.isArray(message.tool_calls)) return [];
  return message.tool_calls.flatMap((raw, index) => {
    if (!isRecord(raw) || !isRecord(raw.function)) return [];
    const name = raw.function.name;
    if (typeof name !== "string" || !name.trim()) return [];
    const id = typeof raw.id === "string" && raw.id.trim() ? raw.id : `call_${index}`;
    const args = raw.function.arguments;
    const serialized = typeof args === "string" ? args : JSON.stringify(args ?? {});
    return [{ id, name: name.trim(), arguments: serialized }];
  });
}

function parseToolResponse(response: AITransportResponse): PromptLlmToolResponse {
  if (!response.ok) throw new Error(providerError(response));
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.body);
  } catch (error) {
    throw new Error(
      `Prompt LLM returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.choices)) {
    throw new Error("Prompt LLM response does not contain choices");
  }
  const choice: unknown = parsed.choices[0];
  if (!isRecord(choice)) throw new Error("Prompt LLM returned an empty choice");
  if (choice.finish_reason === "length") {
    throw new Error("Prompt LLM output was truncated; increase maxTokens or context size");
  }
  if (!isRecord(choice.message)) {
    throw new Error("Prompt LLM choice does not contain a message");
  }
  const toolCalls = parseToolCalls(choice.message);
  const content =
    typeof choice.message.content === "string" ? choice.message.content : "";
  if (toolCalls.length > 0) return { content, toolCalls };
  if (content.trim()) return { content, toolCalls: [] };
  if (typeof choice.message.reasoning_content === "string") {
    throw new Error(
      "Prompt LLM returned reasoning instead of content; disable thinking on the local engine",
    );
  }
  throw new Error("Prompt LLM returned empty message content");
}

function toolMessages(
  messages: PromptLlmMessage[],
  imageUrls: string[],
): Array<Record<string, unknown>> {
  const firstUser = messages.findIndex((message) => message.role === "user");
  return messages.map((message, index) => {
    if (message.role === "assistant" && message.toolCalls?.length) {
      return {
        role: "assistant",
        content: message.content ?? null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: call.arguments },
        })),
      };
    }
    if (message.role === "tool") {
      return {
        role: "tool",
        tool_call_id: message.toolCallId ?? "",
        content: message.content ?? "",
      };
    }
    if (message.role === "user" && index === firstUser) {
      return { role: "user", content: userContent(message.content ?? "", imageUrls) };
    }
    return { role: message.role, content: message.content ?? "" };
  });
}

function validateImageUrl(value: string): void {
  if (value.startsWith("data:image/")) return;
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") return;
  } catch {
    // The shared validation below provides one consistent error.
  }
  throw new Error("Prompt reference images must be HTTP(S) or data:image URLs");
}

function userContent(
  text: string,
  imageUrls: string[],
): string | Array<Record<string, unknown>> {
  if (imageUrls.length === 0) return text;
  imageUrls.forEach(validateImageUrl);
  return [
    { type: "text", text },
    ...imageUrls.map((url) => ({
      type: "image_url",
      image_url: { url },
    })),
  ];
}

export class OpenAiCompatiblePromptLlm implements PromptOrchestratorLlm {
  private readonly endpoint: string;

  constructor(
    private readonly config: OpenAiPromptLlmConfig,
    private readonly transport: PromptLlmTransport = requestWithFetch,
  ) {
    this.endpoint = resolveEndpoint(config.endpoint);
    if (!config.model.trim()) throw new Error("Prompt LLM model is required");
  }

  async countTokens(text: string): Promise<number> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json",
    };
    if (this.config.apiKey?.trim()) {
      headers.authorization = `Bearer ${this.config.apiKey.trim()}`;
    }
    const response = await this.transport({
      method: "POST",
      url: resolveTokenizeEndpoint(this.config.endpoint),
      headers,
      body: JSON.stringify({ content: text }),
      timeoutMs: 10_000,
    });
    if (!response.ok) throw new Error(providerError(response));
    const parsed = JSON.parse(response.body) as { tokens?: unknown };
    if (!Array.isArray(parsed.tokens)) {
      throw new Error("Prompt LLM /tokenize response does not contain tokens");
    }
    return parsed.tokens.length;
  }

  private requestHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json",
    };
    if (this.config.apiKey?.trim()) {
      headers.authorization = `Bearer ${this.config.apiKey.trim()}`;
    }
    return headers;
  }

  private commonBody(request: {
    mode: PromptOrchestrationMode;
    maxTokens?: number;
    imageUrls?: string[];
  }): Record<string, unknown> {
    return {
      model: this.config.model,
      temperature: request.mode === "random" ? 0.8 : 0.3,
      // Token metrics are observational, not a reason to stop a prompt mid-sentence.
      max_tokens: request.maxTokens ?? this.config.maxTokens ?? 4096,
      // Image embeddings are not covered by token-only KV reuse; disabling the
      // prompt cache for vision requests avoids mixing two images that share
      // the same placeholder token layout.
      ...(request.imageUrls?.length ? { cache_prompt: false } : {}),
      ...(this.config.disableThinking !== false
        ? { chat_template_kwargs: { enable_thinking: false } }
        : {}),
    };
  }

  private async post(body: Record<string, unknown>): Promise<AITransportResponse> {
    return this.transport({
      method: "POST",
      url: this.endpoint,
      headers: this.requestHeaders(),
      body: JSON.stringify({ ...body, stream: false }),
      timeoutMs: this.config.timeoutMs ?? AI_REQUEST_TIMEOUT_MS,
    });
  }

  /**
   * Streams one completion. Any failure before the first delta falls back to a
   * buffered request so a provider without SSE support still produces a result;
   * after the first delta a failure is reported instead of silently restarting.
   */
  private async withStreaming(
    body: Record<string, unknown>,
    stream: PromptLlmStreamCallbacks,
    fallback: () => Promise<string>,
  ): Promise<string> {
    const startedAt = Date.now();
    let emitted = false;
    try {
      return await this.streamCompletion(
        body,
        {
          ...stream,
          onDelta: (delta) => {
            emitted = true;
            stream.onDelta?.(delta);
          },
        },
        startedAt,
      );
    } catch (error) {
      if (emitted) throw error;
      stream.onMode?.("buffered");
      const content = await fallback();
      stream.onStats?.({
        mode: "buffered",
        completionTokens: estimatePromptTokens(content),
        source: "estimate",
      });
      return content;
    }
  }

  private async streamCompletion(
    body: Record<string, unknown>,
    stream: PromptLlmStreamCallbacks,
    startedAt: number,
  ): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.timeoutMs ?? AI_REQUEST_TIMEOUT_MS,
    );
    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: this.requestHeaders(),
        body: JSON.stringify({
          ...body,
          stream: true,
          stream_options: { include_usage: true },
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(
          providerError({
            ok: false,
            status: response.status,
            statusText: response.statusText,
            headers: {},
            body: text,
          }),
        );
      }
      if (!response.body) {
        throw new Error("Prompt LLM returned no stream body");
      }
      stream.onMode?.("stream");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let content = "";
      let firstTokenAt = 0;
      let lastTokenAt = 0;
      const usageRef: { value: { completionTokens?: number; promptTokens?: number } | null } = { value: null };

      const handleData = (data: string): void => {
        if (!data || data === "[DONE]") return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(data);
        } catch {
          return;
        }
        if (!isRecord(parsed)) return;
        if (isRecord(parsed.usage)) {
          usageRef.value = {
            ...(typeof parsed.usage.completion_tokens === "number"
              ? { completionTokens: parsed.usage.completion_tokens }
              : {}),
            ...(typeof parsed.usage.prompt_tokens === "number"
              ? { promptTokens: parsed.usage.prompt_tokens }
              : {}),
          };
        }
        const choice = Array.isArray(parsed.choices) ? parsed.choices[0] : undefined;
        if (!isRecord(choice)) return;
        if (choice.finish_reason === "length") {
          throw new Error("Prompt LLM output was truncated; increase maxTokens or context size");
        }
        const delta = isRecord(choice.delta) ? choice.delta.content : undefined;
        if (typeof delta !== "string" || !delta) return;
        const now = Date.now();
        if (!firstTokenAt) firstTokenAt = now;
        lastTokenAt = now;
        content += delta;
        stream.onDelta?.(delta);
      };

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          const event = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          for (const line of event.split("\n")) {
            if (!line.startsWith("data:")) continue;
            handleData(line.slice(5).trim());
          }
          boundary = buffer.indexOf("\n\n");
        }
      }
      if (!content.trim()) {
        throw new Error("Prompt LLM returned empty message content");
      }
      const usage = usageRef.value;
      const completionTokens = usage?.completionTokens ?? estimatePromptTokens(content);
      const generationMs = lastTokenAt && firstTokenAt ? lastTokenAt - firstTokenAt : 0;
      stream.onStats?.({
        mode: "stream",
        ...(firstTokenAt ? { firstTokenMs: firstTokenAt - startedAt } : {}),
        completionTokens,
        ...(generationMs > 0
          ? { tokensPerSecond: Math.round((completionTokens / generationMs) * 1000 * 10) / 10 }
          : {}),
        source: usage?.completionTokens !== undefined ? "provider" : "estimate",
      });
      return content;
    } finally {
      clearTimeout(timeout);
    }
  }

  async complete(request: PromptLlmCompletionRequest): Promise<string> {
    const body = {
      ...this.commonBody(request),
      messages: [
        { role: "system", content: request.messages.system },
        {
          role: "user",
          content: userContent(request.messages.user, request.imageUrls ?? []),
        },
      ],
      response_format: { type: "json_object" },
    };
    if (request.stream?.onDelta) {
      return this.withStreaming(body, request.stream, async () => {
        return parseResponse(await this.post(body));
      });
    }
    return parseResponse(await this.post(body));
  }

  async completeWithTools(request: PromptLlmToolRequest): Promise<PromptLlmToolResponse> {
    const body = {
      ...this.commonBody(request),
      messages: toolMessages(request.messages, request.imageUrls ?? []),
      tools: request.tools,
      tool_choice: request.toolChoice ?? "auto",
    };
    // Only the final turn may stream: tool-call turns need the complete JSON
    // tool_calls array before Core can execute anything.
    if (request.stream?.onDelta && (request.toolChoice ?? "auto") === "none") {
      const content = await this.withStreaming(body, request.stream, async () => {
        return parseToolResponse(await this.post(body)).content;
      });
      return { content, toolCalls: [] };
    }
    return parseToolResponse(await this.post(body));
  }
}
