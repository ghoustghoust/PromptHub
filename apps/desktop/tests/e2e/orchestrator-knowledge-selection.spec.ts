import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { captureAppPage, launchPromptHub, setAppLanguage } from "./helpers/electron";

const PACK_ROOT = path.resolve(__dirname, "../../../../prompt/new/Skill-Film-v2.00.1");
const SCREENSHOT_DIR = path.resolve(__dirname, "../../../../outputs/a6-phase2-20261125");

async function openOrchestrator(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  const entry = page.getByRole("button", { name: "Prompt Orchestrator", exact: true });
  if ((await entry.count()) > 0) await entry.click();
  await expect(page.getByTestId("orchestrator-writing-layer")).toBeVisible();
}

test("imports a pack through the UI, selects modules, restores and deletes it", async () => {
  test.setTimeout(300_000);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "prompthub-e2e-knowledge-"));
  let launched: Awaited<ReturnType<typeof launchPromptHub>> | null = null;
  try {
    launched = await launchPromptHub(null, { userDataDir });
    await setAppLanguage(launched.page, "en");
    await openOrchestrator(launched.page);

    await expect(launched.page.getByTestId("writing-layer-knowledge")).toBeVisible();
    await expect(launched.page.getByTestId("writing-layer-knowledge-empty")).toBeVisible();

    // The hidden picker carries webkitdirectory; Electron maps each File back to
    // its real path, so choosing any file inside the pack yields the root.
    await launched.page.getByTestId("writing-layer-knowledge-directory").setInputFiles(PACK_ROOT);
    const dialog = launched.page.getByTestId("knowledge-import-dialog");
    await expect(dialog).toBeVisible({ timeout: 60_000 });
    await expect(dialog).toContainText("160 modules");
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await captureAppPage(launched.app, launched.page, path.join(SCREENSHOT_DIR, "02-import-preview.png"));

    await launched.page.getByTestId("knowledge-import-confirm").click();
    await expect(dialog).toHaveCount(0, { timeout: 60_000 });
    await expect(launched.page.getByText("film-creative-kb")).toBeVisible({ timeout: 30_000 });

    const firstPack = launched.page.locator('[data-testid^="writing-layer-knowledge-pack-"]').first();
    await firstPack.check();
    const firstModule = launched.page
      .locator('[data-testid^="writing-layer-knowledge-module-"]')
      .first();
    await expect(firstModule).toBeVisible({ timeout: 30_000 });
    await firstModule.check();
    await expect(launched.page.getByTestId("writing-layer-knowledge-tokens")).not.toContainText(
      "0 module tokens",
    );
    await launched.page.waitForTimeout(1200);
    await captureAppPage(launched.app, launched.page, path.join(SCREENSHOT_DIR, "01-knowledge-selected.png"));

    await launched.app.close();
    launched = null;

    launched = await launchPromptHub(null, { userDataDir });
    await openOrchestrator(launched.page);
    const restoredPack = launched.page
      .locator('[data-testid^="writing-layer-knowledge-pack-"]')
      .first();
    await expect(restoredPack).toBeChecked({ timeout: 30_000 });
    const restoredModule = launched.page
      .locator('[data-testid^="writing-layer-knowledge-module-"]')
      .first();
    await expect(restoredModule).toBeChecked({ timeout: 30_000 });

    const deleteButton = launched.page
      .locator('[data-testid^="writing-layer-knowledge-delete-"]')
      .first();
    await deleteButton.click();
    const confirm = launched.page.getByRole("alertdialog");
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(restoredPack).toHaveCount(0, { timeout: 30_000 });
    await expect(launched.page.getByTestId("writing-layer-knowledge-empty")).toBeVisible();
  } finally {
    if (launched) await launched.app.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});