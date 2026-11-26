import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";

import { captureAppPage, closePromptHub, launchPromptHub, setAppSettings } from "./helpers/electron";

const SCREENSHOT_DIR = path.resolve(__dirname, "../../../../outputs/prompt-new-batch1-20261126");

async function resize(
  app: ElectronApplication,
  width: number,
  height: number,
): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => {
    const window = BrowserWindow.getAllWindows()[0];
    window?.setSize(size.width, size.height);
    window?.showInactive();
  }, { width, height });
}

/**
 * The app restores the last view, so the orchestrator is either already open
 * or reachable through the prompts view entry.
 */
async function openOrchestrator(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  const writingLayer = page.getByTestId("orchestrator-writing-layer");
  const entry = page.getByRole("button", { name: "Prompt Orchestrator", exact: true });
  await expect
    .poll(async () => (await writingLayer.count()) + (await entry.count()), { timeout: 30_000 })
    .toBeGreaterThan(0);
  if ((await writingLayer.count()) === 0) {
    await entry.click();
  }
  await expect(writingLayer).toBeVisible();
}

test("the K2 content range stays a user choice across a restart", async () => {
  test.setTimeout(180_000);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prompthub-content-range-"));
  const profile = path.join(root, "profile");
  let app: ElectronApplication | null = null;
  try {
    const launched = await launchPromptHub(null, { userDataDir: profile });
    app = launched.app;
    const page = launched.page;
    await setAppSettings(page, { language: "en", autoCheckUpdate: false });
    await page.getByRole("button", { name: "Prompt Orchestrator", exact: true }).click();
    await expect(page.getByTestId("orchestrator-writing-layer")).toBeVisible();

    // The content range belongs to the rule card that declares one.
    await expect(page.getByTestId("orchestrator-content-range")).toHaveCount(0);
    await page.getByRole("button", { name: "Rule card" }).click();
    await page.getByRole("option", { name: "Krea 2 / K2" }).click();

    const range = page.getByTestId("orchestrator-content-range");
    await expect(range).toBeVisible();
    const adult = page.getByTestId("orchestrator-content-range-adult");
    await expect(adult).not.toBeChecked();

    await adult.check();
    await expect(adult).toBeChecked();

    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await resize(app, 1440, 900);
    await page.waitForTimeout(800);
    await captureAppPage(app, page, path.join(SCREENSHOT_DIR, "03-content-range-1440.png"));

    await resize(app, 900, 1300);
    await page.waitForTimeout(500);
    const narrow = await range.evaluate((element) => ({
      overflow: element.scrollWidth > element.clientWidth + 1,
      width: element.getBoundingClientRect().width,
    }));
    expect(narrow.overflow).toBe(false);
    expect(narrow.width).toBeGreaterThan(200);
    await captureAppPage(app, page, path.join(SCREENSHOT_DIR, "04-content-range-900.png"));

    // The switch must survive a restart through the real workspace store.
    await page.waitForTimeout(1200);
    await app.close();
    app = null;

    const restarted = await launchPromptHub(null, { userDataDir: profile });
    app = restarted.app;
    await resize(app, 1440, 900);
    await setAppSettings(restarted.page, { language: "en", autoCheckUpdate: false });
    await openOrchestrator(restarted.page);
    await restarted.page.getByRole("button", { name: "Rule card" }).click();
    await restarted.page.getByRole("option", { name: "Krea 2 / K2" }).click();
    await expect(restarted.page.getByTestId("orchestrator-content-range")).toBeVisible();
    await expect(restarted.page.getByTestId("orchestrator-content-range-adult")).toBeChecked();

    await closePromptHub(app, profile);
    app = null;
  } finally {
    if (app) await closePromptHub(app, profile).catch(() => undefined);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
