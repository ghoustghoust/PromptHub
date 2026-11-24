import { expect, test, type ElectronApplication } from "@playwright/test";
import fs from "fs";
import path from "path";

import { captureAppPage, launchPromptHub, setAppSettings } from "./helpers/electron";

const SCREENSHOT_DIR = path.resolve(__dirname, "../../../../outputs/p9-streaming-20261124");

async function showWindow(app: ElectronApplication): Promise<void> {
  // The suite launches hidden, and a hidden window stops painting; showing it
  // without focus makes capturePage reflect the current DOM instead of a stale frame.
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window?.setSize(1440, 900);
    window?.showInactive();
  });
}

test("starts the local engine with staged progress and streams the final turn", async () => {
  test.setTimeout(420_000);
  const profile = path.join(
    process.env.TEMP ?? "C:\\Windows\\Temp",
    "qwenwork",
    "PromptHub-native-manual-test",
    "profile",
  );
  const launched = await launchPromptHub(null, { userDataDir: profile });
  const { app, page } = launched;
  let finished = false;
  try {
    await setAppSettings(page, { language: "en", autoCheckUpdate: false });
    // The isolated profile may already be left in the orchestrator view, where
    // the sidebar shortcut is hidden; only click it when it is actually offered.
    const orchestratorEntry = page.getByRole("button", {
      name: "Prompt Orchestrator",
      exact: true,
    });
    if ((await orchestratorEntry.count()) > 0) await orchestratorEntry.click();
    await expect(page.getByTestId("orchestrator-writing-layer")).toBeVisible();

    // Local engine: staged progress must appear while the IPC call is still pending.
    await page.getByTestId("orchestrator-model-source-local").click();
    await page.getByTestId("orchestrator-engine-start").click();
    await expect(page.getByTestId("local-engine-progress")).toBeVisible({ timeout: 15_000 });
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await page.getByTestId("orchestrator-local-engine").evaluate((element) => {
      const panel = element.closest('[data-testid="orchestrator-config-panel"]');
      if (panel) {
        panel.scrollTop =
          element.getBoundingClientRect().top - panel.getBoundingClientRect().top + panel.scrollTop - 16;
      }
    });
    await showWindow(app);
    await page.waitForTimeout(1200);
    await captureAppPage(app, page, path.join(SCREENSHOT_DIR, "01-engine-stage-progress.png"));
    await expect(page.getByTestId("orchestrator-engine-start")).toHaveCount(0, {
      timeout: 180_000,
    });

    // A short intent keeps the real generation bounded.
    await page
      .locator('textarea[aria-label="Intent or source prompt"]')
      .fill("a quiet portrait in soft window light");
    await page.getByTestId("orchestrator-run").click();

    await expect(page.getByTestId("orchestrator-streaming")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("orchestrator-streaming")).toHaveAttribute(
      "data-mode",
      "stream",
      { timeout: 120_000 },
    );
    await expect(page.getByTestId("orchestrator-streaming-text")).not.toHaveText(
      "No visible text yet.",
      { timeout: 60_000 },
    );
    await expect(page.getByTestId("orchestrator-streaming")).toContainText("Structure seen", {
      timeout: 60_000,
    });
    await showWindow(app);
    await page.waitForTimeout(400);
    await captureAppPage(app, page, path.join(SCREENSHOT_DIR, "02-streaming.png"));

    // The final result replaces the stream and keeps the measured stats.
    await expect(page.getByTestId("orchestrator-reuse-intent")).toBeVisible({ timeout: 180_000 });
    const runStats = await page.getByTestId("orchestrator-run-stats").innerText();
    console.log("RUN_STATS " + runStats.replace(/\s+/g, " ").trim());
    expect(runStats).toMatch(/\d+(\.\d+)? tok\/s/);
    await page.waitForTimeout(500);
    await page.getByTestId("orchestrator-reuse-intent").click();
    await expect(page.getByTestId("orchestrator-intent-origin")).toBeVisible();
    const intentValue = await page
      .locator('textarea[aria-label="Intent or source prompt"]')
      .inputValue();
    expect(intentValue.trim().length).toBeGreaterThan(20);
    await showWindow(app);
    await page.waitForTimeout(400);
    await captureAppPage(app, page, path.join(SCREENSHOT_DIR, "03-reused-intent.png"));
    finished = true;
  } finally {
    // Always give VRAM back, even when an assertion fails.
    await page.evaluate(() => window.api.localLlama.unload().catch(() => undefined)).catch(() => undefined);
    await app.close();
  }
  expect(finished).toBe(true);
});
