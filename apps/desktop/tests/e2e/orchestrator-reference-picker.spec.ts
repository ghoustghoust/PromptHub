import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test, type Page } from "@playwright/test";

import { captureAppPage, launchPromptHub, setAppLanguage } from "./helpers/electron";

const OUTPUT_DIR = path.resolve(__dirname, "../../../../outputs/a6-phase2-20261125");
const SOURCE_PROFILE = path.join(
  process.env.TEMP ?? "C:\\Windows\\Temp",
  "qwenwork",
  "PromptHub-native-manual-test",
  "profile",
);

async function openOrchestrator(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  const entry = page.getByRole("button", { name: "Prompt Orchestrator", exact: true });
  if ((await entry.count()) > 0) await entry.click();
  await expect(page.getByTestId("orchestrator-reference-picker")).toBeVisible();
}

test("selects at most three color cards and restores them", async () => {
  test.setTimeout(300_000);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "prompthub-e2e-reference-"));
  let launched: Awaited<ReturnType<typeof launchPromptHub>> | null = null;
  try {
    launched = await launchPromptHub(null, { userDataDir });
    await setAppLanguage(launched.page, "en");
    await launched.app.close();
    launched = null;

    const sourceDb = new DatabaseSync(path.join(SOURCE_PROFILE, "data", "prompthub.db"), {
      readOnly: true,
    });
    const rows = sourceDb
      .prepare("SELECT * FROM prompt_reference_items WHERE thumbnail_path IS NOT NULL LIMIT 4")
      .all() as Array<Record<string, string>>;
    sourceDb.close();
    expect(rows).toHaveLength(4);

    const dataDir = path.join(userDataDir, "data");
    const imagesDir = path.join(dataDir, "images");
    fs.mkdirSync(imagesDir, { recursive: true });
    const db = new DatabaseSync(path.join(dataDir, "prompthub.db"));
    db.exec(`
      CREATE TABLE IF NOT EXISTS prompt_reference_items (
        id TEXT PRIMARY KEY, name_zh TEXT NOT NULL, name_en TEXT, category TEXT NOT NULL,
        nationality TEXT, era TEXT, summary TEXT NOT NULL, palette_json TEXT NOT NULL DEFAULT '[]',
        style_json TEXT NOT NULL DEFAULT '{}', thumbnail_path TEXT, source_path TEXT NOT NULL,
        source_hash TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
    `);
    const insert = db.prepare(
      `INSERT INTO prompt_reference_items
         (id, name_zh, name_en, category, nationality, era, summary, palette_json,
          style_json, thumbnail_path, source_path, source_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const row of rows) {
      const fileName = row.thumbnail_path;
      fs.copyFileSync(
        path.join(SOURCE_PROFILE, "data", "images", fileName),
        path.join(imagesDir, fileName),
      );
      insert.run(
        row.id, row.name_zh, row.name_en, row.category, row.nationality, row.era,
        row.summary, row.palette_json, row.style_json, fileName, row.source_path,
        row.source_hash, row.created_at, row.updated_at,
      );
    }
    db.close();

    launched = await launchPromptHub(null, { userDataDir });
    await openOrchestrator(launched.page);
    const cards = launched.page.locator('[data-testid^="reference-card-"]');
    await expect(cards).toHaveCount(4, { timeout: 30_000 });
    for (let index = 0; index < 3; index += 1) await cards.nth(index).click();
    await expect(launched.page.getByTestId("reference-selected-count")).toContainText("3 / 3");
    await expect(cards.nth(3)).toBeDisabled();
    await launched.page.waitForTimeout(1200);
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    await captureAppPage(
      launched.app,
      launched.page,
      path.join(OUTPUT_DIR, "11-reference-picker.png"),
    );

    await launched.app.close();
    launched = null;
    launched = await launchPromptHub(null, { userDataDir });
    await openOrchestrator(launched.page);
    await expect(launched.page.getByTestId("reference-selected-count")).toContainText("3 / 3", {
      timeout: 30_000,
    });
    await expect(launched.page.getByTestId("reference-selected-chips").locator("button")).toHaveCount(3);
  } finally {
    if (launched) await launched.app.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});