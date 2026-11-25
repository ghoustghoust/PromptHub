import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { captureAppPage, launchPromptHub, setAppLanguage } from "./helpers/electron";

const PACK_ROOT = path.resolve(
  __dirname,
  "../../../../prompt/new/压缩包版本+老唐电影级分镜skill-s9/老唐电影级分镜skill-s9",
);
const OUTPUT_DIR = path.resolve(__dirname, "../../../../outputs/a6-phase2-20261125");

async function openOrchestrator(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  const entry = page.getByRole("button", { name: "Prompt Orchestrator", exact: true });
  if ((await entry.count()) > 0) await entry.click();
  await expect(page.getByTestId("orchestrator-writing-layer")).toBeVisible();
}

test("shows contracts as always-on and lets the import preview change a role", async () => {
  test.setTimeout(300_000);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "prompthub-e2e-knowledge-roles-"));
  let launched: Awaited<ReturnType<typeof launchPromptHub>> | null = null;
  try {
    launched = await launchPromptHub(null, { userDataDir });
    await setAppLanguage(launched.page, "en");
    await openOrchestrator(launched.page);

    await launched.page.getByTestId("writing-layer-knowledge-directory").setInputFiles(PACK_ROOT);
    const dialog = launched.page.getByTestId("knowledge-import-dialog");
    await expect(dialog).toBeVisible({ timeout: 60_000 });
    await expect(dialog).toContainText("7 modules");

    // Flip the first contract section to knowledge to prove the override is saved.
    await launched.page.getByTestId("knowledge-import-role-0-0").selectOption("knowledge");
    await launched.page.getByTestId("knowledge-import-confirm").click();
    await expect(dialog).toHaveCount(0, { timeout: 60_000 });

    const pack = launched.page.locator('[data-testid^="writing-layer-knowledge-pack-"]').first();
    await expect(pack).toBeVisible({ timeout: 30_000 });
    await pack.check();

    await expect(launched.page.getByText("Always on")).toHaveCount(6, { timeout: 30_000 });
    await expect(
      launched.page.locator('[data-testid^="writing-layer-knowledge-module-"]'),
    ).toHaveCount(1);
    await expect(launched.page.getByTestId("writing-layer-contract-tokens")).toContainText(
      "always-on",
    );

    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    await captureAppPage(
      launched.app,
      launched.page,
      path.join(OUTPUT_DIR, "07-contract-roles.png"),
    );
  } finally {
    if (launched) await launched.app.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});