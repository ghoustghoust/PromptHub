import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { captureAppPage, launchPromptHub, setAppLanguage } from "./helpers/electron";

const PACK_ROOT = path.resolve(
  __dirname,
  "../../../../prompt/new/斯坦尼斯拉夫斯基表演体系skill/斯坦尼斯拉夫斯基表演体系skill/Kimi最终稿",
);
const OUTPUT_DIR = path.resolve(__dirname, "../../../../outputs/a6-phase2-20261125");

async function openOrchestrator(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  const entry = page.getByRole("button", { name: "Prompt Orchestrator", exact: true });
  if ((await entry.count()) > 0) await entry.click();
  await expect(page.getByTestId("orchestrator-writing-layer")).toBeVisible();
}

test("selects one contract group and restores it after a restart", async () => {
  test.setTimeout(300_000);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "prompthub-e2e-contract-group-"));
  let launched: Awaited<ReturnType<typeof launchPromptHub>> | null = null;
  try {
    launched = await launchPromptHub(null, { userDataDir });
    await setAppLanguage(launched.page, "en");
    await openOrchestrator(launched.page);

    const committed = await launched.page.evaluate(async (rootPath) => {
      const preview = await window.api.promptKnowledge.previewPack({ rootPath });
      if (preview.ok !== true) return preview.error.message;
      const result = await window.api.promptKnowledge.commitImport({
        preview: preview.data,
        packName: "斯坦尼斯拉夫斯基（Kimi 规范版）",
      });
      return result.ok === true ? result.data.moduleCount : result.error.message;
    }, PACK_ROOT);
    expect(committed).toBe(42);

    await launched.page.reload();
    await openOrchestrator(launched.page);
    const pack = launched.page.locator('[data-testid^="writing-layer-knowledge-pack-"]').first();
    await expect(pack).toBeVisible({ timeout: 30_000 });
    await pack.check();
    await expect(launched.page.getByTestId("writing-layer-contract-group-hint")).toBeVisible();

    await launched.page.getByTestId("writing-layer-contract-group-storyboard").click();
    await expect(launched.page.getByTestId("writing-layer-contract-group-storyboard")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect
      .poll(async () => launched.page.locator('[data-testid^="writing-layer-knowledge-contract-"]').count())
      .toBe(5);
    await expect(launched.page.getByTestId("writing-layer-contract-tokens")).toContainText("3059");

    await launched.page.getByTestId("writing-layer-contract-group-script").click();
    await expect
      .poll(async () => launched.page.locator('[data-testid^="writing-layer-knowledge-contract-"]').count())
      .toBe(8);
    await expect(launched.page.getByTestId("writing-layer-contract-tokens")).toContainText("5104");
    await launched.page.waitForTimeout(1200);
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    await captureAppPage(
      launched.app,
      launched.page,
      path.join(OUTPUT_DIR, "10-contract-group-script.png"),
    );

    await launched.app.close();
    launched = null;
    launched = await launchPromptHub(null, { userDataDir });
    await openOrchestrator(launched.page);
    await expect(launched.page.getByTestId("writing-layer-contract-group-script")).toHaveAttribute(
      "aria-pressed",
      "true",
      { timeout: 30_000 },
    );
    await expect
      .poll(async () => launched.page.locator('[data-testid^="writing-layer-knowledge-contract-"]').count())
      .toBe(8);
  } finally {
    if (launched) await launched.app.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});