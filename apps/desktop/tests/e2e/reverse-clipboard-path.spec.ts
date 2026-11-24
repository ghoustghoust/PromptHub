import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test, type ElectronApplication } from "@playwright/test";

import { captureAppPage, closePromptHub, launchPromptHub, setAppSettings } from "./helpers/electron";

const execFileAsync = promisify(execFile);
const SCREENSHOT_DIR = path.resolve(__dirname, "../../../../outputs/p9-batch4-20261124");

async function copyFileToClipboard(filePath: string): Promise<void> {
  await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-Command",
    `Set-Clipboard -Path '${filePath.replace(/'/g, "''")}'`,
  ]);
}

async function copyTextToClipboard(value: string): Promise<void> {
  await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-Command",
    `Set-Clipboard -Value '${value.replace(/'/g, "''")}'`,
  ]);
}

test("reverse accepts a file copied in Explorer and quoted or bare path text", async () => {
  test.setTimeout(120_000);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prompthub-clipboard-"));
  const profile = path.join(root, "profile");
  const imagePath = path.resolve(__dirname, "../../../../prompt/fc388e80facf224fb9cdaeb01fe90870.png");
  let app: ElectronApplication | null = null;
  try {
    const launched = await launchPromptHub(null, { userDataDir: profile });
    app = launched.app;
    const page = launched.page;
    await setAppSettings(page, { language: "en", autoCheckUpdate: false });
    await page.getByRole("button", { name: "Prompt Orchestrator", exact: true }).click();
    await expect(page.getByTestId("orchestrator-writing-layer")).toBeVisible();

    const configPanel = page.getByTestId("orchestrator-config-panel");
    await configPanel.locator('button[aria-haspopup="listbox"][aria-label="Mode"]').click();
    await page.getByRole("option", { name: "Reverse", exact: true }).click();
    await expect(page.getByTestId("orchestrator-paste-image")).toBeVisible();

    // 1) Explorer-style copy: only a file drop payload, no text.
    await copyFileToClipboard(imagePath);
    await page.getByTestId("orchestrator-paste-image").click();
    await expect(page.getByTestId("orchestrator-clear-images")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("alert")).toHaveCount(0);

    // 2) Quoted path text (what users often paste from a terminal).
    await page.getByTestId("orchestrator-clear-images").click();
    await copyTextToClipboard(`"${imagePath}"`);
    await page.getByTestId("orchestrator-paste-image").click();
    await expect(page.getByTestId("orchestrator-clear-images")).toBeVisible({ timeout: 15_000 });

    // 3) Bare path text.
    await page.getByTestId("orchestrator-clear-images").click();
    await copyTextToClipboard(imagePath);
    await page.getByTestId("orchestrator-paste-image").click();
    await expect(page.getByTestId("orchestrator-clear-images")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("alert")).toHaveCount(0);

    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await captureAppPage(app, page, path.join(SCREENSHOT_DIR, "01-reverse-pasted-image.png"));
  } finally {
    if (app) await closePromptHub(app, profile).catch(() => undefined);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
