import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { captureAppPage, closePromptHub, launchPromptHub, setAppSettings } from "./helpers/electron";

const SCREENSHOT_DIR = path.resolve(__dirname, "../../../../outputs/p9-deepseek-20261124");

function readEnvKey(name: string): string {
  const envPath = path.resolve(__dirname, "../../../..", ".env");
  const line = fs
    .readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .find((entry) => entry.startsWith(`${name}=`));
  if (!line) throw new Error(`${name} is missing from .env`);
  return line.slice(name.length + 1).trim().replace(/^"|"$/g, "");
}

async function openOrchestrator(page: Page): Promise<void> {
  const entry = page.getByRole("button", { name: "Prompt Orchestrator", exact: true });
  if ((await entry.count()) > 0) await entry.click();
  await expect(page.getByTestId("orchestrator-writing-layer")).toBeVisible();
}

async function waitForResult(page: Page): Promise<void> {
  const decisions = page.getByRole("tab", { name: "Strategy comparison", exact: true });
  await expect(decisions).toBeEnabled({ timeout: 240_000 });
  await page.getByRole("tab", { name: "Complete prompt", exact: true }).click();
  await expect(page.getByTestId("orchestrator-reuse-intent")).toBeVisible({ timeout: 30_000 });
}

async function readGenerated(page: Page): Promise<string> {
  const comparison = page.getByTestId("orchestrator-comparison");
  if ((await comparison.count()) > 0) {
    return (await comparison.locator("button").allInnerTexts()).join(" ").replace(/\s+/g, " ").trim();
  }
  const textareas = page.getByTestId("orchestrator-result-panel").locator("textarea[readonly]");
  return (await textareas.nth((await textareas.count()) - 1).inputValue()).trim();
}

test("orchestrates with the cloud DeepSeek model, streams and stops", async () => {
  test.setTimeout(600_000);
  const apiKey = readEnvKey("DEEPSEEK_API_KEY");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prompthub-deepseek-"));
  const profile = path.join(root, "profile");
  let app: Awaited<ReturnType<typeof launchPromptHub>>["app"] | null = null;
  try {
    const launched = await launchPromptHub(null, { userDataDir: profile });
    app = launched.app;
    const page = launched.page;
    await setAppSettings(page, { language: "en", autoCheckUpdate: false });

    const configured = await page.evaluate(async ({ key }) => {
      const settings = (await window.api.settings.get()) as Record<string, unknown>;
      const models = Array.isArray(settings.aiModels) ? settings.aiModels : [];
      const model = {
        id: "deepseek-chat-e2e",
        type: "chat",
        name: "DeepSeek Chat (E2E)",
        provider: "deepseek",
        apiProtocol: "openai",
        apiKey: key,
        apiUrl: "https://api.deepseek.com",
        model: "deepseek-chat",
        isDefault: false,
        capabilities: { chat: true },
        chatParams: { temperature: 0.7, maxTokens: 2048, stream: true },
      };
      await window.api.settings.set({
        aiModels: [...models.filter((item) => (item as { id?: string }).id !== model.id), model],
      } as unknown as Parameters<typeof window.api.settings.set>[0]);
      return model.id;
    }, { key: apiKey });
    expect(configured).toBe("deepseek-chat-e2e");

    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("#root button:not([disabled])").first()).toBeVisible();
    await openOrchestrator(page);

    const configPanel = page.getByTestId("orchestrator-config-panel");
    await configPanel.locator('button[aria-haspopup="listbox"][aria-label="Chat model"]').click();
    await page.getByRole("option", { name: "DeepSeek Chat (E2E)", exact: true }).click();

    const intent = page.locator('textarea[aria-label="Intent or source prompt"]');
    await intent.fill("a quiet portrait of an elderly fisherman mending nets at dawn");
    await page.getByTestId("orchestrator-run").click();
    await expect(page.getByTestId("orchestrator-streaming")).toHaveAttribute("data-mode", "stream", {
      timeout: 120_000,
    });
    await waitForResult(page);
    const generated = await readGenerated(page);
    expect(generated.length).toBeGreaterThan(40);
    const stats = (await page.getByTestId("orchestrator-run-stats").count())
      ? (await page.getByTestId("orchestrator-run-stats").innerText()).replace(/\s+/g, " ").trim()
      : "";
    const warnings = (await page.getByTestId("orchestrator-warnings").count())
      ? (await page.getByTestId("orchestrator-warnings").innerText()).replace(/\s+/g, " ").trim()
      : "";
    expect(warnings.toLowerCase()).not.toContain("fallback");

    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window?.setSize(1440, 950);
      window?.showInactive();
    });
    await page.waitForTimeout(400);
    await captureAppPage(app, page, path.join(SCREENSHOT_DIR, "01-deepseek-result.png"));

    // Stop a long cloud generation and confirm the partial text is kept.
    await intent.fill(
      "Write an extremely long battlefield description with hundreds of soldiers, banners, horses, smoke, mud and scattered weapons.",
    );
    await page.getByTestId("orchestrator-run").click();
    await expect(page.getByTestId("orchestrator-streaming")).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(1500);
    await page.getByTestId("orchestrator-cancel").click();
    await expect(page.getByTestId("orchestrator-stopped-note")).toBeVisible({ timeout: 30_000 });
    await captureAppPage(app, page, path.join(SCREENSHOT_DIR, "02-deepseek-stopped.png"));

    fs.writeFileSync(
      path.join(SCREENSHOT_DIR, "cloud-run.json"),
      JSON.stringify({ model: "deepseek-chat", generated, stats, warnings }, null, 2),
      "utf8",
    );
  } finally {
    if (app) await closePromptHub(app, profile).catch(() => undefined);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
