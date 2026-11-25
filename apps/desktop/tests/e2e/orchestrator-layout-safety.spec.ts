import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { captureAppPage, launchPromptHub, setAppLanguage } from "./helpers/electron";

const SCREENSHOT_DIR = path.resolve(__dirname, "../../../../outputs/a6-phase1-20261125");
const IMAGE_PATH = path.resolve(__dirname, "../../../../prompt/fc388e80facf224fb9cdaeb01fe90870.png");
const PROFILE = path.join(
  process.env.TEMP ?? "C:\\Windows\\Temp",
  "qwenwork",
  "PromptHub-native-manual-test",
  "profile",
);

test.describe.configure({ mode: "serial" });

async function openOrchestrator(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  const entry = page.getByRole("button", { name: "Prompt Orchestrator", exact: true });
  if ((await entry.count()) > 0) await entry.click();
  await expect(page.getByTestId("orchestrator-writing-layer")).toBeVisible();
}

async function chooseLayoutFormat(page: Page): Promise<void> {
  const panel = page.getByTestId("orchestrator-config-panel");
  await panel.locator('button[aria-haspopup="listbox"][aria-label="Output format"]').click();
  await page.getByRole("option", { name: "Exact Layout JSON", exact: true }).click();
  await expect(page.getByTestId("moss-layout-editor")).toBeVisible();
}

async function boxCount(page: Page): Promise<number> {
  return page.getByTestId("moss-layout-canvas").locator("[data-layout-box]").count();
}

/**
 * Empties any draft restored from the shared profile before a test starts, so
 * repeated runs never accumulate boxes.
 */
async function clearCanvas(page: Page): Promise<void> {
  const clear = page.getByTestId("layout-clear-canvas");
  await expect(clear).toBeVisible();
  if (await clear.isDisabled()) return;
  await clear.click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => boxCount(page)).toBe(0);
}

function screenshot(name: string): string {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  return path.join(SCREENSHOT_DIR, name);
}

test("locks the layout structure and blocks orchestration while captions are filled", async () => {
  test.setTimeout(420_000);
  const launched = await launchPromptHub(null, { userDataDir: PROFILE });
  const { app, page } = launched;
  try {
    await openOrchestrator(page);
    await page.getByTestId("orchestrator-model-source-local").click();
    const startButton = page.getByTestId("orchestrator-engine-start");
    if ((await startButton.count()) > 0) await startButton.click();
    await expect(page.getByTestId("orchestrator-engine-start")).toHaveCount(0, {
      timeout: 240_000,
    });

    await chooseLayoutFormat(page);
    await clearCanvas(page);
    await page.locator('textarea[aria-label="Intent or source prompt"]').fill(
      "A quiet street at dusk with a lantern and a cat",
    );
    for (let index = 0; index < 6; index += 1) {
      await page.getByTestId("layout-add-object").click();
    }
    const runButton = page.getByTestId("orchestrator-run");
    await expect(runButton).toBeEnabled({ timeout: 30_000 });

    await page.getByTestId("layout-refine-captions").click();
    await expect(page.getByTestId("orchestrator-cancel-layout-assist")).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId("layout-structure-locked")).toBeVisible();
    await expect(runButton).toBeDisabled();
    await expect(page.getByTestId("layout-add-object")).toBeDisabled();
    await expect(page.getByTestId("layout-add-background")).toBeDisabled();
    await expect(page.getByTestId("layout-add-text")).toBeDisabled();
    await expect(page.getByTestId("layout-delete-box")).toBeDisabled();
    await expect(page.getByTestId("layout-refine-captions")).toBeDisabled();
    await expect(page.getByTestId("layout-reverse-image")).toBeDisabled();
    await captureAppPage(app, page, screenshot("01-structure-locked.png"));

    await page.getByTestId("orchestrator-cancel-layout-assist").click();
    await expect(page.getByTestId("orchestrator-cancel-layout-assist")).toHaveCount(0, {
      timeout: 30_000,
    });
    await expect(page.getByTestId("layout-structure-locked")).toHaveCount(0);
    await expect(runButton).toBeEnabled();
    await expect(page.getByTestId("layout-add-object")).toBeEnabled();
  } finally {
    await page
      .evaluate(() => window.api.localLlama.unload().catch(() => undefined))
      .catch(() => undefined);
    await app.close();
  }
});

test("asks before a reverse replaces a non-empty canvas and keeps the boxes on cancel", async () => {
  test.setTimeout(180_000);
  const launched = await launchPromptHub(null, { userDataDir: PROFILE });
  const { app, page } = launched;
  try {
    await openOrchestrator(page);
    await page.getByTestId("orchestrator-model-source-local").click();
    await chooseLayoutFormat(page);
    await clearCanvas(page);
    await page.getByTestId("layout-add-object").click();
    await expect(page.getByTestId("layout-reverse-image")).toBeEnabled({ timeout: 30_000 });
    const before = await boxCount(page);
    expect(before).toBeGreaterThan(0);

    await page.getByTestId("layout-reverse-input").setInputFiles(IMAGE_PATH);
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    await expect(dialog).toContainText("Replace the current canvas?");
    await captureAppPage(app, page, screenshot("02-reverse-confirm.png"));

    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId("orchestrator-cancel-layout-assist")).toHaveCount(0);
    expect(await boxCount(page)).toBe(before);
    // Leave the shared profile empty so the next run starts from a blank canvas.
    await clearCanvas(page);
  } finally {
    await app.close();
  }
});

test("restores the canvas draft and its boxes after an app restart", async () => {
  test.setTimeout(180_000);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "prompthub-e2e-layout-"));
  let launched: Awaited<ReturnType<typeof launchPromptHub>> | null = null;
  try {
    launched = await launchPromptHub(null, { userDataDir });
    await setAppLanguage(launched.page, "en");
    await openOrchestrator(launched.page);
    await chooseLayoutFormat(launched.page);
    await launched.page.getByTestId("layout-add-object").click();
    await launched.page.getByTestId("layout-add-object").click();
    // New boxes are cascaded; move the selected one so the restored screenshot
    // can show that both survived with distinct positions.
    await launched.page.getByLabel("Y1 (top)").fill("450");
    await launched.page.getByLabel("X1 (left)").fill("500");
    await launched.page.getByLabel("Canvas width").fill("1200");
    await launched.page.getByLabel("Canvas height").fill("800");
    await launched.page.waitForTimeout(1500);
    await launched.app.close();
    launched = null;

    launched = await launchPromptHub(null, { userDataDir });
    await openOrchestrator(launched.page);
    await chooseLayoutFormat(launched.page);
    await expect(launched.page.getByLabel("Canvas width")).toHaveValue("1200", {
      timeout: 30_000,
    });
    await expect(launched.page.getByLabel("Canvas height")).toHaveValue("800");
    await expect
      .poll(async () => boxCount(launched!.page), { timeout: 30_000 })
      .toBe(2);
    await launched.page.getByTestId("moss-layout-editor").scrollIntoViewIfNeeded();
    await expect(launched.page.getByTestId("layout-box-2")).toBeVisible();
    await launched.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.maximize();
    });
    await launched.page.waitForTimeout(500);
    await launched.page.evaluate(() => {
      document
        .querySelector('[data-testid="moss-layout-canvas"]')
        ?.scrollIntoView({ block: "center" });
    });
    await launched.page.waitForTimeout(400);
    await captureAppPage(launched.app, launched.page, screenshot("03-restored-canvas.png"));

    // Clearing the canvas must be durable: a blank canvas stays blank on reopen.
    await clearCanvas(launched.page);
    await launched.page.waitForTimeout(1500);
    await launched.app.close();
    launched = null;

    launched = await launchPromptHub(null, { userDataDir });
    await openOrchestrator(launched.page);
    await chooseLayoutFormat(launched.page);
    await expect.poll(async () => boxCount(launched!.page), { timeout: 30_000 }).toBe(0);
  } finally {
    if (launched) await launched.app.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});