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
const OUTPUT_DIR = path.resolve(__dirname, "../../../../outputs/prompt-new-branch1-20261126");

const PROMPTS = [
  "An elderly lighthouse keeper repairs a brass compass inside a storm-lashed control room, cold side light, 85mm lens, salt on the glass, no modern electronics, no captions, preserve the cramped composition.",
  "\"Ganyu (Genshin Impact)\" repairing a wooden clock in a quiet hillside workshop, overcast window light, medium shot, no combat, no text, do not infer any additional outfit or physical features.",
  "Two adult brothers share one umbrella in a crowded night market, rain on their coats, steam from food stalls, neon reflections, anxious but not angry, handheld camera, no legible brand names.",
  "An astronaut botanist checks a cracked seed tray in a rotating greenhouse, two moons beyond the glass, loose soil floating gently, practical lights only, no helmet damage, no extra crew.",
  "A masked dancer rehearses alone in an abandoned opera house, red curtain moving in a cross-draft, wide-angle view from the last row, dust in the light, no audience, no letters or logos.",
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

async function readTrace(page: Page): Promise<{
  queryCount: number;
  identityCount: number;
  candidateCount: number;
  fallbackCount: number;
  text: string;
}> {
  const decisions = page.getByRole("tab", { name: "Strategy comparison", exact: true });
  await decisions.click();
  const trace = page.getByTestId("retrieval-trace");
  if ((await trace.count()) === 0) {
    return { queryCount: 0, identityCount: 0, candidateCount: 0, fallbackCount: 0, text: "" };
  }
  const toggles = trace.locator('[data-testid^="retrieval-query-toggle-"]');
  const queryCount = await toggles.count();
  for (let index = 0; index < queryCount; index += 1) {
    await toggles.nth(index).click();
  }
  return {
    queryCount,
    identityCount: await trace.locator('[data-testid^="retrieval-identity-"]').count(),
    candidateCount: await trace.locator('[data-testid^="retrieval-candidate-"]').count(),
    fallbackCount: await trace.locator('[data-testid^="retrieval-fallback-"]').count(),
    text: (await trace.innerText()).replace(/\s+/g, " ").trim(),
  };
}

function seedIsolatedVocabulary(profile: string): number {
  const dataDir = path.join(profile, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const target = path.join(dataDir, "prompthub.db");
  const snapshot = path.join(dataDir, "vocabulary-snapshot.db");
  const source = new DatabaseSync(SOURCE_DB, { readOnly: true });
  // VACUUM INTO is a consistent copy even when the isolated source is open elsewhere.
  source.exec(`VACUUM INTO '${snapshot.replace(/'/g, "''")}'`);
  const count = Number((source.prepare("SELECT COUNT(*) AS n FROM prompt_terms").get() as { n: number }).n);
  source.close();
  // The app has completed its first-run initialization and is closed at this point.
  fs.copyFileSync(snapshot, target);
  const targetDb = new DatabaseSync(target);
  // Keep only the vocabulary test precondition, not another session's selections.
  targetDb.exec("DELETE FROM prompt_orchestrator_state");
  targetDb.close();
  return count;
}

async function resize(app: ElectronApplication, width: number, height: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => {
    BrowserWindow.getAllWindows()[0]?.setSize(size.width, size.height);
  }, { width, height });
}

test("five new complex prompts expose their real retrieval evidence", async () => {
  test.setTimeout(3_600_000);
  const source = JSON.parse(fs.readFileSync(SOURCE_CONFIG, "utf8")) as LocalLlamaEngineConfig;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prompthub-retrieval-trace-live-"));
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
    const vocabularyProbe = await page.evaluate(async () => {
      const reply = await window.api.promptOrchestrator.searchTerms({
        query: "soft light",
        category: "lighting",
        limit: 5,
      });
      return reply.ok === true ? reply.data.length : -1;
    });
    expect(vocabularyProbe).toBeGreaterThan(0);
    await page.getByTestId("orchestrator-model-source-local").click();
    const start = page.getByTestId("orchestrator-engine-start");
    if ((await start.count()) > 0) await start.click();
    await expect(page.getByTestId("orchestrator-engine-start")).toHaveCount(0, {
      timeout: 300_000,
    });
    await choosePolish(page);
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    let successfulRuns = 0;
    for (const [index, intent] of PROMPTS.entries()) {
      let completed = false;
      for (let attempt = 1; attempt <= 2 && !completed; attempt += 1) {
        await page.locator('textarea[aria-label="Intent or source prompt"]').fill(intent);
        await page.getByTestId("orchestrator-run").click();
        await expect(page.getByTestId("orchestrator-streaming")).toBeVisible({ timeout: 60_000 });
        await expect(page.getByTestId("orchestrator-streaming")).toHaveCount(0, {
          timeout: 900_000,
        });
        const decisions = page.getByRole("tab", { name: "Strategy comparison", exact: true });
        await expect(decisions).toBeEnabled({ timeout: 30_000 });
        await page.getByRole("tab", { name: "Complete prompt", exact: true }).click();
        await expect(page.getByTestId("orchestrator-reuse-intent")).toBeVisible({ timeout: 30_000 });
        const completePrompt = await readGeneratedPrompt(page);
        const warnings = page.getByTestId("orchestrator-warnings");
        const warningText = (await warnings.count()) > 0
          ? (await warnings.innerText()).replace(/\s+/g, " ").trim()
          : "";
        const trace = await readTrace(page);
        const degraded = warningText.includes("deterministic fallback used") ||
          trace.text.includes("Composition → Deterministic fallback");

        report.runs.push({
          iteration: index + 1,
          attempt,
          mode: "Polish",
          input: intent,
          completePrompt,
          warnings: warningText,
          degraded,
          ...trace,
        });
        completed = !degraded && completePrompt.length > 40;
      }
      expect(completed).toBe(true);
      successfulRuns += 1;

      if (index === 0) {
        await resize(app, 1440, 950);
        await captureAppPage(app, page, path.join(OUTPUT_DIR, "01-retrieval-trace-1440.png"));
        await resize(app, 900, 1200);
        const resultOpen = page.getByTestId("orchestrator-result-open");
        if ((await resultOpen.count()) > 0) await resultOpen.click();
        const resultSlot = page.getByTestId("orchestrator-result-slot");
        await resultSlot.scrollIntoViewIfNeeded();
        await expect(resultSlot).toBeVisible();
        const visibleTrace = page.getByTestId("retrieval-trace");
        await expect(visibleTrace).toBeVisible();
        await visibleTrace.evaluate((element) => {
          element.scrollIntoView({ block: "start", inline: "center" });
        });
        await page.evaluate(() => new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }));
        const traceGeometry = await visibleTrace.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return {
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
            width: window.innerWidth,
            height: window.innerHeight,
          };
        });
        expect(traceGeometry.left).toBeGreaterThanOrEqual(0);
        expect(traceGeometry.right).toBeLessThanOrEqual(traceGeometry.width);
        expect(traceGeometry.top).toBeGreaterThanOrEqual(0);
        expect(traceGeometry.top).toBeLessThan(traceGeometry.height);
        expect(traceGeometry.bottom).toBeGreaterThan(0);
        const narrowOverflow = await resultSlot.evaluate((element) =>
          element.scrollWidth > element.clientWidth + 1);
        expect(narrowOverflow).toBe(false);
        await captureAppPage(app, page, path.join(OUTPUT_DIR, "02-retrieval-trace-900.png"));
        await resize(app, 1440, 950);
      }
    }

    expect(successfulRuns).toBe(5);
    const searched = report.runs.reduce(
      (sum, run) => sum + Number(run.queryCount) + Number(run.identityCount),
      0,
    );
    expect(searched).toBeGreaterThan(0);
    expect(report.runs.some((run) => Number(run.candidateCount) > 0)).toBe(true);
    report.complete = true;
  } finally {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUTPUT_DIR, "live-runs.json"), JSON.stringify(report, null, 2));
    if (app) {
      await app.evaluate(() => window.api.localLlama.unload().catch(() => undefined)).catch(() => undefined);
      await closePromptHub(app, profile, { preserveUserDataDir: !report.complete });
      if (!report.complete) console.log(`Retrieval trace profile preserved at ${profile}`);
      app = null;
    }
  }
});
