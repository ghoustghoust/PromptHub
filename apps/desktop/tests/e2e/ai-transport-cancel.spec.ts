import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { once } from "node:events";
import { expect, test } from "@playwright/test";

import { closePromptHub, launchPromptHub } from "./helpers/electron";

test("cancels a streaming AI transport request by id", async () => {
  test.setTimeout(90_000);
  const server = http.createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
    });
    request.on("end", () => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      const timer = setInterval(() => {
        response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "tick" } }] })}\n\n`);
      }, 200);
      response.on("close", () => clearInterval(timer));
      void raw;
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind");
  const endpoint = `http://127.0.0.1:${address.port}/v1/chat/completions`;

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prompthub-ai-cancel-"));
  const profile = path.join(root, "profile");
  let app: Awaited<ReturnType<typeof launchPromptHub>>["app"] | null = null;
  try {
    const launched = await launchPromptHub(null, { userDataDir: profile });
    app = launched.app;
    const page = launched.page;
    await page.waitForLoadState("domcontentloaded");

    const outcome = await page.evaluate(async (url) => {
      const errors: string[] = [];
      const pending = window.api.ai.requestStream(
        {
          method: "POST",
          url,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model: "test", messages: [], stream: true }),
          timeoutMs: 60_000,
          requestId: "cancel-test",
        },
        { onError: (error) => errors.push(error) },
      );
      await new Promise((resolve) => setTimeout(resolve, 1_200));
      const cancelled = await window.api.ai.cancel("cancel-test");
      const response = await pending;
      return { cancelled, response, errors };
    }, endpoint);

    expect(outcome.cancelled).toEqual({ cancelled: true });
    expect(outcome.response.ok).toBe(false);
    // The abort reason can surface as "cancelled" from our handler or as the
    // platform's "aborted" wording; either way the request must not succeed.
    expect((outcome.response.error ?? outcome.errors.join(" ")).length).toBeGreaterThan(0);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (app) await closePromptHub(app, profile).catch(() => undefined);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
