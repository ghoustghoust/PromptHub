import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import type { LocalLlamaEngineConfig } from "@prompthub/shared/types";

import { captureAppPage, closePromptHub, launchPromptHub, setAppLanguage } from "./helpers/electron";

const SOURCE_CONFIG = path.join(
  process.env.TEMP ?? "C:\\Windows\\Temp",
  "qwenwork",
  "PromptHub-native-manual-test",
  "profile",
  "config",
  "local-llama.json",
);
const SOURCE_DB = path.join(
  process.env.TEMP ?? "C:\\Windows\\Temp",
  "qwenwork",
  "PromptHub-native-manual-test",
  "profile",
  "data",
  "prompthub.db",
);
const OUTPUT_DIR = path.resolve(__dirname, "../../../../outputs/prompt-new-branch1d-20261126");

/** Five inputs not used by any earlier live run; all take the tool path. */
const PROMPTS = [
  "Ganyu (Genshin Impact) repairs a 1950s rangefinder, soft light from a green bench lamp, 85mm lens, macro detail, tiny screws in a magnetic tray, no modern tools, no brand text. Use the vocabulary library to pick the exact lighting and camera terms.",
  "A coral gardener ties fragments onto a nursery frame underwater, turquoise water with god rays, wide angle, particulate haze, no diver silhouette, no written tags.",
  "A baker scores a sourdough loaf before dawn, warm tungsten light, steam on the window, close-up, flour dust in the air, no shop signage, no hands out of frame. Use the vocabulary library to pick the exact lighting and camera terms.",
  "A radio astronomer tilts a desert dish toward the Milky Way, long exposure sky, low angle, red safety light on the ladder, no aircraft trails, no readable labels.",
  "Backstage at a puppet theatre, a handler adjusts a marionette's strings under a single work light, velvet curtains in shadow, medium shot, no audience, no posters. Use the vocabulary library to pick the exact lighting and camera terms.",
];

async function openOrchestrator(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  const entry = page.getByRole("button", { name: "Prompt Orchestrator", exact: true });
  if ((await entry.count()) > 0) await entry.click();
  await expect(page.getByTestId("orchestrator-writing-layer")).toBeVisible();
}

async function choosePolish(page: Page): Promise<void> {
  await page
    .getByTestId("orchestrator-config-panel")
    .locator('button[aria-haspopup="listbox"][aria-label="Mode"]')
    .click();
  await page.getByRole("option", { name: "Polish", exact: true }).click();
}

async function readGeneratedPrompt(page: Page): Promise<string> {
  const comparison = page.getByTestId("orchestrator-comparison");
  if ((await comparison.count()) > 0) {
    return (await comparison.locator("button").allInnerTexts()).join(" ").replace(/\s+/g, " ").trim();
  }
  const textareas = page.getByTestId("orchestrator-result-panel").locator("textarea[readonly]");
  const count = await textareas.count();
  expect(count).toBeGreaterThanOrEqual(2);
  return (await textareas.nth(count - 1).inputValue()).trim();
}

function seedIsolatedVocabulary(profile: string): number {
  const dataDir = path.join(profile, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const target = path.join(dataDir, "prompthub.db");
  const snapshot = path.join(dataDir, "vocabulary-snapshot.db");
  const source = new DatabaseSync(SOURCE_DB, { readOnly: true });
  source.exec(`VACUUM INTO '${snapshot.replace(/'/g, "''")}'`);
  const count = Number(
    (source.prepare("SELECT COUNT(*) AS n FROM prompt_terms").get() as { n: number }).n,
  );
  source.close();
  fs.copyFileSync(snapshot, target);
  const targetDb = new DatabaseSync(target);
  targetDb.exec("DELETE FROM prompt_orchestrator_state");
  targetDb.close();
  return count;
}

async function resize(app: ElectronApplication, width: number, height: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => {
    BrowserWindow.getAllWindows()[0]?.setSize(size.width, size.height);
  }, { width, height });
}

test("five new complex prompts complete the tool path without downgrading", async () => {
  test.setTimeout(3_600_000);
  const source = JSON.parse(fs.readFileSync(SOURCE_CONFIG, "utf8")) as LocalLlamaEngineConfig;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prompthub-tool-stability-live-"));
  const profile = path.join(root, "profile");
  const report: {
    at: string;
    isolatedProfile: boolean;
    vocabularyCount: number;
    complete: boolean;
    runs: Array<Record<string, unknown>>;
  } = {
    at: new Date().toISOString(),
    isolatedProfile: true,
    vocabularyCount: 0,
    complete: false,
    runs: [],
  };
  let app: ElectronApplication | null = null;
  try {
    const initialized = await launchPromptHub(null, { userDataDir: profile });
    app = initialized.app;
    await setAppLanguage(initialized.page, "en");
    await app.close();
    app = null;

    const vocabularyCount = seedIsolatedVocabulary(profile);
    expect(vocabularyCount).toBeGreaterThan(1000);
    report.vocabularyCount = vocabularyCount;

    const launched = await launchPromptHub(null, { userDataDir: profile });
    app = launched.app;
    const page = launched.page;
    await setAppLanguage(page, "en");
    await page.evaluate(async (nextConfig) => {
      await window.api.localLlama.unload().catch(() => undefined);
      await window.api.localLlama.saveConfig(nextConfig);
    }, { ...source, mmprojPath: "" });

    await openOrchestrator(page);
    await page.getByTestId("orchestrator-model-source-local").click();
    const start = page.getByTestId("orchestrator-engine-start");
    if ((await start.count()) > 0) await start.click();
    await expect(page.getByTestId("orchestrator-engine-start")).toHaveCount(0, {
      timeout: 300_000,
    });
    await choosePolish(page);
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    for (const [index, intent] of PROMPTS.entries()) {
      await page.locator('textarea[aria-label="Intent or source prompt"]').fill(intent);
      await expect(page.getByTestId("orchestrator-task-contract")).toBeVisible({ timeout: 30_000 });
      await page.getByTestId("orchestrator-run").click();
      await expect(page.getByTestId("orchestrator-streaming")).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId("orchestrator-streaming")).toHaveCount(0, {
        timeout: 900_000,
      });

      const decisions = page.getByRole("tab", { name: "Strategy comparison", exact: true });
      await expect(decisions).toBeEnabled({ timeout: 30_000 });
      await decisions.click();
      const panel = page.getByTestId("orchestrator-evidence-panel");
      await expect(panel).toBeVisible({ timeout: 60_000 });
      const panelText = (await panel.innerText()).replace(/\s+/g, " ").trim();
      const rounds = Number(await page.getByTestId("orchestrator-evidence-rounds").innerText());
      const queries = Number(await page.getByTestId("orchestrator-evidence-queries").innerText());
      const candidates = Number(await page.getByTestId("orchestrator-evidence-candidates").innerText());

      await page.getByRole("tab", { name: "Selected fields", exact: true }).click();
      const warnings = page.getByTestId("orchestrator-warnings");
      const warningText = (await warnings.count()) > 0
        ? ((await warnings.first().textContent()) ?? "").replace(/\s+/g, " ").trim()
        : "";
      await page.getByRole("tab", { name: "Complete prompt", exact: true }).click();
      await expect(page.getByTestId("orchestrator-reuse-intent")).toBeVisible({ timeout: 30_000 });
      const completePrompt = await readGeneratedPrompt(page);

      const toolFallback = warningText.includes("Tool retrieval failed");
      const degraded = warningText.includes("deterministic fallback used");

      expect(degraded).toBe(false);
      expect(toolFallback).toBe(false);
      expect(panelText).toContain("Assembly & evidence");
      expect(completePrompt.length).toBeGreaterThan(40);

      report.runs.push({
        iteration: index + 1,
        input: intent,
        completePrompt,
        warnings: warningText,
        degraded,
        toolFallback,
        rounds,
        queries,
        candidates,
      });

      if (index === 0) {
        await page.getByRole("tab", { name: "Strategy comparison", exact: true }).click();
        await resize(app, 1440, 950);
        const evidence = page.getByTestId("orchestrator-evidence-panel");
        await evidence.evaluate((element) => {
          element.scrollIntoView({ block: "start", inline: "center" });
        });
        await page.evaluate(() => new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }));
        await captureAppPage(app, page, path.join(OUTPUT_DIR, "01-tool-stability-1440.png"));
        await resize(app, 900, 1200);
        const resultOpen = page.getByTestId("orchestrator-result-open");
        if ((await resultOpen.count()) > 0) await resultOpen.click();
        const resultSlot = page.getByTestId("orchestrator-result-slot");
        await resultSlot.scrollIntoViewIfNeeded();
        await expect(evidence).toBeVisible();
        const overflow = await resultSlot.evaluate(
          (element) => element.scrollWidth > element.clientWidth + 1,
        );
        expect(overflow).toBe(false);
        await captureAppPage(app, page, path.join(OUTPUT_DIR, "02-tool-stability-900.png"));
        await resize(app, 1440, 950);
        await page.getByRole("tab", { name: "Complete prompt", exact: true }).click();
      }
    }

    expect(report.runs).toHaveLength(5);
    report.complete = true;
  } finally {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUTPUT_DIR, "live-runs.json"), JSON.stringify(report, null, 2));
    if (app) {
      await app.evaluate(() => window.api.localLlama.unload().catch(() => undefined)).catch(() => undefined);
      await closePromptHub(app, profile, { preserveUserDataDir: !report.complete });
      if (!report.complete) console.log(`Tool stability profile preserved at ${profile}`);
      app = null;
    }
  }
});