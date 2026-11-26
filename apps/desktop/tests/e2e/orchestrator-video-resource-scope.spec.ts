import { expect, test, type ElectronApplication } from "@playwright/test";
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

test("video tasks keep the writing layer, knowledge packs and color cards usable", async () => {
  test.setTimeout(180_000);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prompthub-video-scope-"));
  const profile = path.join(root, "profile");
  let app: ElectronApplication | null = null;
  try {
    const launched = await launchPromptHub(null, { userDataDir: profile });
    app = launched.app;
    const page = launched.page;
    await setAppSettings(page, { language: "en", autoCheckUpdate: false });
    await page.getByRole("button", { name: "Prompt Orchestrator", exact: true }).click();
    await expect(page.getByTestId("orchestrator-writing-layer")).toBeVisible();

    // The artist pipeline control belongs to image tasks only.
    await expect(page.getByLabel("Artist pipeline")).toHaveCount(1);

    await page.getByRole("button", { name: "Rule card" }).click();
    await page.getByRole("option", { name: "MiniMax-H3 Video" }).click();
    await expect(page.getByTestId("orchestrator-mode-guide")).toContainText("Text-to-video");
    await expect(page.getByLabel("Artist pipeline")).toHaveCount(0);

    // The shared resources must stay visible and editable in a video task.
    await expect(page.getByTestId("orchestrator-writing-layer")).toBeVisible();
    await expect(page.getByTestId("writing-layer-knowledge")).toBeVisible();
    await expect(page.getByTestId("orchestrator-reference-picker")).toBeVisible();

    const layer = page.getByTestId("writing-layer-custom");
    await layer.fill("Cold hard key light, locked camera.");
    await expect(layer).toHaveValue("Cold hard key light, locked camera.");
    await expect(page.getByTestId("writing-layer-tokens")).not.toContainText("0 /");

    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await resize(app, 1440, 900);
    await page.waitForTimeout(500);
    await captureAppPage(app, page, path.join(SCREENSHOT_DIR, "01-video-resources-1440.png"));

    await resize(app, 900, 1300);
    await page.waitForTimeout(500);
    const narrow = await page.getByTestId("orchestrator-writing-layer").evaluate((element) => ({
      overflow: element.scrollWidth > element.clientWidth + 1,
      width: element.getBoundingClientRect().width,
    }));
    expect(narrow.overflow).toBe(false);
    expect(narrow.width).toBeGreaterThan(200);
    await captureAppPage(app, page, path.join(SCREENSHOT_DIR, "02-video-resources-900.png"));

    await closePromptHub(app, profile);
    app = null;
  } finally {
    if (app) await closePromptHub(app, profile).catch(() => undefined);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
