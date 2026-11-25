import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test, type Page } from "@playwright/test";
import type { LocalLlamaEngineConfig } from "@prompthub/shared/types";

import { launchPromptHub, setAppLanguage } from "./helpers/electron";

const ROOT = "G:\\program\\3.prompt-forge";
const SOURCE_PROFILE = path.join(
  process.env.TEMP ?? "C:\\Windows\\Temp",
  "qwenwork",
  "PromptHub-native-manual-test",
  "profile",
);
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const PROFILE = path.join(process.env.TEMP ?? "C:\\Windows\\Temp", "qwenwork", `ref-32k-ui-${STAMP}`);
const OUTPUT = path.join(ROOT, "outputs", "a6-phase2-20261125", "engine-32k-diagnosis");
const INTENT =
  "A lone courier waits under a streetlamp in the rain at midnight, holding a sealed letter.";

async function openOrchestrator(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  const entry = page.getByRole("button", { name: "Prompt Orchestrator", exact: true });
  if ((await entry.count()) > 0) await entry.click();
  await expect(page.getByTestId("orchestrator-reference-picker")).toBeVisible();
}

async function status(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(async () => window.api.localLlama.getStatus() as unknown as Record<string, unknown>);
}

async function startEngine(page: Page, config: LocalLlamaEngineConfig): Promise<void> {
  await page.evaluate(async (nextConfig) => {
    await window.api.localLlama.unload().catch(() => undefined);
    await window.api.localLlama.saveConfig(nextConfig);
  }, { ...config, mmprojPath: "", contextSize: 32768 });
  await openOrchestrator(page);
  await page.getByTestId("orchestrator-model-source-local").click();
  const start = page.getByTestId("orchestrator-engine-start");
  if ((await start.count()) > 0) await start.click();
  await expect(start).toHaveCount(0, { timeout: 300_000 });
  await expect.poll(async () => (await status(page)).phase, { timeout: 300_000 }).toBe("running");
}

async function clickRun(page: Page): Promise<void> {
  await page.getByTestId("orchestrator-run").click();
  await expect(page.getByTestId("orchestrator-streaming")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("orchestrator-streaming")).toHaveCount(0, { timeout: 900_000 });
  await expect(page.getByTestId("orchestrator-run-stats")).toBeVisible({ timeout: 60_000 });
}

async function readComplete(page: Page): Promise<string> {
  return page.evaluate(() => {
    const root = document.querySelector('[data-testid="orchestrator-comparison"]');
    if (!root) return "";
    const right = root.querySelectorAll(".grid.grid-cols-2 > button");
    return Array.from(right)
      .map((node) => (node.textContent ?? "").trim())
      .filter(Boolean)
      .join(" ");
  });
}

test("run 32K UI comparison and wait for reference provenance", async () => {
  test.setTimeout(1_500_000);
  const config = JSON.parse(
    fs.readFileSync(path.join(SOURCE_PROFILE, "config", "local-llama.json"), "utf8"),
  ) as LocalLlamaEngineConfig;
  fs.mkdirSync(OUTPUT, { recursive: true });
  fs.mkdirSync(PROFILE, { recursive: true });
  const timeline: Array<Record<string, unknown>> = [];
  let launched: Awaited<ReturnType<typeof launchPromptHub>> | null = null;
  try {
    launched = await launchPromptHub(null, { userDataDir: PROFILE });
    await setAppLanguage(launched.page, "en");
    await launched.app.close();
    launched = null;

    const sourceDb = new DatabaseSync(path.join(SOURCE_PROFILE, "data", "prompthub.db"), {
      readOnly: true,
    });
    const rows = sourceDb
      .prepare(
        `SELECT * FROM prompt_reference_items
          WHERE thumbnail_path IS NOT NULL GROUP BY category ORDER BY category LIMIT 3`,
      )
      .all() as Array<Record<string, string>>;
    sourceDb.close();
    const images = path.join(PROFILE, "data", "images");
    fs.mkdirSync(images, { recursive: true });
    const db = new DatabaseSync(path.join(PROFILE, "data", "prompthub.db"));
    db.exec(`CREATE TABLE IF NOT EXISTS prompt_reference_items (
      id TEXT PRIMARY KEY, name_zh TEXT NOT NULL, name_en TEXT, category TEXT NOT NULL,
      nationality TEXT, era TEXT, summary TEXT NOT NULL, palette_json TEXT NOT NULL DEFAULT '[]',
      style_json TEXT NOT NULL DEFAULT '{}', thumbnail_path TEXT, source_path TEXT NOT NULL,
      source_hash TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);`);
    const insert = db.prepare(`INSERT INTO prompt_reference_items
      (id, name_zh, name_en, category, nationality, era, summary, palette_json, style_json,
       thumbnail_path, source_path, source_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const row of rows) {
      fs.copyFileSync(
        path.join(SOURCE_PROFILE, "data", "images", row.thumbnail_path),
        path.join(images, row.thumbnail_path),
      );
      insert.run(
        row.id, row.name_zh, row.name_en, row.category, row.nationality, row.era,
        row.summary, row.palette_json, row.style_json, row.thumbnail_path, row.source_path,
        row.source_hash, row.created_at, row.updated_at,
      );
    }
    db.close();

    launched = await launchPromptHub(null, { userDataDir: PROFILE });
    await startEngine(launched.page, config);
    timeline.push({ step: "engine-started", status: await status(launched.page) });

    const intent = launched.page.locator('textarea[aria-label="Intent or source prompt"]');
    await intent.fill(INTENT);
    const baselineStarted = Date.now();
    await clickRun(launched.page);
    const baselinePrompt = await readComplete(launched.page);
    expect(baselinePrompt.length).toBeGreaterThan(50);
    const baselineTrace = launched.page.getByRole("tab", { name: "Term trace", exact: true });
    const baselineTraceEnabled = await baselineTrace.isEnabled();
    await launched.page.screenshot({ path: path.join(OUTPUT, "ui-baseline-result.png"), fullPage: false });
    timeline.push({
      step: "baseline-finished",
      wallMs: Date.now() - baselineStarted,
      traceEnabled: baselineTraceEnabled,
      status: await status(launched.page),
    });

    await launched.page.reload();
    await openOrchestrator(launched.page);
    await intent.fill(INTENT);
    await launched.page.getByTestId("orchestrator-model-source-local").click();
    const cards = launched.page.locator('[data-testid^="reference-card-"]');
    for (let i = 0; i < 3; i += 1) await cards.nth(i).click();
    await expect(launched.page.locator('[data-testid^="reference-chip-"]')).toHaveCount(3);
    await launched.page.screenshot({ path: path.join(OUTPUT, "ui-reference-cards-selected.png"), fullPage: false });
    const cardsStarted = Date.now();
    await clickRun(launched.page);
    const cardsPrompt = await readComplete(launched.page);
    expect(cardsPrompt.length).toBeGreaterThan(50);
    const trace = launched.page.getByRole("tab", { name: "Term trace", exact: true });
    await expect(trace).toBeEnabled({ timeout: 60_000 });
    await trace.click();
    const provenanceRows = await launched.page.locator('table tbody tr').allTextContents();
    expect(provenanceRows.length).toBeGreaterThan(0);
    await launched.page.screenshot({ path: path.join(OUTPUT, "ui-cards-provenance.png"), fullPage: false });
    timeline.push({
      step: "cards-finished",
      wallMs: Date.now() - cardsStarted,
      provenanceRows,
      status: await status(launched.page),
    });

    fs.writeFileSync(
      path.join(OUTPUT, "live-reference-32k-ui.json"),
      JSON.stringify(
        {
          at: new Date().toISOString(),
          profile: PROFILE,
          intent: INTENT,
          references: rows.map(({ id, name_zh, category }) => ({ id, nameZh: name_zh, category })),
          baseline: { completePrompt: baselinePrompt, traceEnabled: baselineTraceEnabled },
          cards: { completePrompt: cardsPrompt, provenanceRows },
          timeline,
        },
        null,
        2,
      ),
      "utf8",
    );
  } finally {
    const logSource = path.join(PROFILE, "logs", "local-llama-engine.log");
    if (fs.existsSync(logSource)) {
      fs.copyFileSync(logSource, path.join(OUTPUT, "local-llama-engine-ui.log"));
    }
    fs.copyFileSync(
      path.join(PROFILE, "config", "local-llama.json"),
      path.join(OUTPUT, "local-llama-ui.json"),
    );
    fs.writeFileSync(
      path.join(OUTPUT, "ui-run-timeline.json"),
      JSON.stringify({ at: new Date().toISOString(), profile: PROFILE, timeline }, null, 2),
      "utf8",
    );
    if (launched) {
      await launched.page
        .evaluate(() => window.api.localLlama.unload().catch(() => undefined))
        .catch(() => undefined);
      await launched.app.close();
    }
  }
});
