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
const OUTPUT_DIR = path.resolve(__dirname, "../../../../outputs/prompt-new-branch1e-20261126");

/** Deterministic PRNG so the random sample can be replayed from the report seed. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = 20261126;

interface LibraryTerm {
  id: string;
  category: string;
  en: string;
  zh: string | null;
}

interface Sample {
  guidance: "agent-led" | "human-led";
  band: "short" | "medium" | "long";
  term: LibraryTerm;
  intent: string;
}

const ZH_SCENES = [
  "清晨的旧车站",
  "雨后的狭窄厨房",
  "深夜的便利店",
  "傍晚的码头",
  "午后的图书馆",
  "下雪的巷口",
  "停电的工作室",
  "海边的废弃泳池",
];
const EN_SCENES = [
  "a lone figure waiting with a closed umbrella",
  "steam rising from a chipped enamel cup",
  "a shelf of dusty glass jars",
  "wet cobblestones reflecting one street lamp",
  "an open notebook with no readable writing",
  "a rusted bicycle leaning on a brick wall",
  "fog pressing against a tall window",
  "a bare bulb swinging above a wooden table",
];
const EN_DETAILS = [
  "shallow depth of field, fine grain",
  "cool ambient bounce with one warm practical",
  "wide composition with generous negative space",
  "close three-quarter view, restrained palette",
  "symmetrical framing, quiet posture",
  "handheld framing, slight motion blur",
];
const ZH_DETAILS = [
  "不要出现任何文字或商标",
  "人物保持克制，不要夸张表情",
  "保留潮湿的空气感",
  "避免现代电子设备",
  "构图留白，不要塞满画面",
];

async function openOrchestrator(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  const entry = page.getByRole("button", { name: "Prompt Orchestrator", exact: true });
  if ((await entry.count()) > 0) await entry.click();
  await expect(page.getByTestId("orchestrator-writing-layer")).toBeVisible();
}

async function chooseMode(page: Page): Promise<void> {
  await page
    .getByTestId("orchestrator-config-panel")
    .locator('button[aria-haspopup="listbox"][aria-label="Mode"]')
    .click();
  await page.getByRole("option", { name: "Polish", exact: true }).click();
}

async function chooseGuidance(page: Page, human: boolean): Promise<void> {
  await page
    .getByTestId("orchestrator-config-panel")
    .locator('button[aria-haspopup="listbox"][aria-label="Who drives the draft"]')
    .click();
  await page
    .getByRole("option", {
      name: human ? "Term-driven · human decides" : "Intent-driven · auto compose",
      exact: true,
    })
    .click();
}

async function clearTerms(page: Page): Promise<void> {
  await chooseGuidance(page, true);
  const clear = page.getByTestId("term-picker-clear");
  if ((await clear.count()) > 0) await clear.click();
  await expect(page.getByTestId("term-picker-selected")).toHaveCount(0, { timeout: 10_000 });
  await chooseGuidance(page, false);
}

async function pickTerm(
  page: Page,
  term: LibraryTerm,
): Promise<{ picked: boolean; label: string }> {
  await chooseGuidance(page, true);
  const categories = page.getByTestId("term-picker-categories");
  if ((await categories.count()) === 0) {
    await page.getByTestId("term-picker-expand").click();
  }
  const search = page.getByRole("textbox", { name: "Search terms" });
  if ((await search.count()) === 0) {
    await page.getByTestId("term-picker-mode-fields").click();
  }
  const candidates = [
    term.en.replace(/_/g, " "),
    term.en,
    term.zh ?? "",
  ].filter((value) => value.trim().length > 0);
  for (const query of candidates) {
    await search.fill(query);
    const chip = page.locator('[data-testid^="term-chip-"]').first();
    try {
      await expect(chip).toBeVisible({ timeout: 8_000 });
    } catch {
      continue;
    }
    const label = (await chip.innerText()).replace(/\s+/g, " ").trim();
    await chip.click();
    await expect(page.getByTestId("term-picker-selected")).toBeVisible({ timeout: 10_000 });
    return { picked: true, label };
  }
  return { picked: false, label: "" };
}

/** Picks a common English term so the fixed-fact check has a real target. */
async function pickLatinFallback(page: Page): Promise<string> {
  await chooseGuidance(page, true);
  const search = page.getByRole("textbox", { name: "Search terms" });
  if ((await search.count()) === 0) {
    await page.getByTestId("term-picker-mode-fields").click();
  }
  for (const query of ["golden hour", "soft light", "85mm lens", "wide angle", "close-up"]) {
    await search.fill(query);
    const chip = page.locator('[data-testid^="term-chip-"]').first();
    try {
      await expect(chip).toBeVisible({ timeout: 8_000 });
    } catch {
      continue;
    }
    const label = (await chip.innerText()).replace(/\s+/g, " ").trim();
    if (!/[A-Za-z]/.test(label)) continue;
    await chip.click();
    await expect(page.getByTestId("term-picker-selected")).toBeVisible({ timeout: 10_000 });
    return label;
  }
  return "";
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

function randomTerms(profile: string, limit: number): LibraryTerm[] {
  const target = path.join(profile, "data", "prompthub.db");
  const db = new DatabaseSync(target, { readOnly: true });
  const rows = db
    .prepare(
      `SELECT id, category, en, zh FROM prompt_terms
       WHERE category IN ('lighting','camera','style','clothing','pose','environment')
         AND validation_status != 'deprecated'
         AND en IS NOT NULL AND length(trim(en)) > 1
       ORDER BY RANDOM() LIMIT ?`,
    )
    .all(limit) as Array<Record<string, unknown>>;
  db.close();
  return rows.map((row) => ({
    id: String(row.id),
    category: String(row.category),
    en: String(row.en),
    zh: row.zh === null ? null : String(row.zh),
  }));
}

function buildSamples(terms: LibraryTerm[]): Sample[] {
  const random = mulberry32(SEED);
  const pick = <T,>(items: T[]): T => items[Math.floor(random() * items.length)];
  const bands: Array<Sample["band"]> = ["short", "medium", "long"];
  const samples: Sample[] = [];
  for (let index = 0; index < 10; index += 1) {
    const band = bands[index % 3];
    const term = terms[index % terms.length];
    const guidance = index % 2 === 0 ? "agent-led" : "human-led";
    const zhScene = pick(ZH_SCENES);
    const enScene = pick(EN_SCENES);
    const enDetail = pick(EN_DETAILS);
    const zhDetail = pick(ZH_DETAILS);
    const termText = term.en || term.zh || term.id;
    const parts: string[] = [];
    if (band === "short") {
      parts.push(`${zhScene}，${enScene}，reference term: ${termText}。`);
    } else if (band === "medium") {
      parts.push(`${zhScene}，${enScene}，${enDetail}，reference term: ${termText}。`);
      parts.push(`${zhDetail}。`);
    } else {
      parts.push(
        `场景：${zhScene}。画面主体：${enScene}，${enDetail}，参考词条：${termText}。`,
      );
      parts.push(
        `${zhDetail}。Textures stay believable, no extra props, no modern electronics, keep the quiet atmosphere.`,
      );
    }
    samples.push({ guidance, band, term, intent: parts.join(" ") });
  }
  return samples;
}

async function resize(app: ElectronApplication, width: number, height: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => {
    BrowserWindow.getAllWindows()[0]?.setSize(size.width, size.height);
  }, { width, height });
}

test("ten randomized mixed-language samples stay stable", async () => {
  test.setTimeout(3_600_000);
  const source = JSON.parse(fs.readFileSync(SOURCE_CONFIG, "utf8")) as LocalLlamaEngineConfig;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prompthub-random-ten-live-"));
  const profile = path.join(root, "profile");
  const report: {
    at: string;
    seed: number;
    isolatedProfile: boolean;
    vocabularyCount: number;
    complete: boolean;
    runs: Array<Record<string, unknown>>;
  } = {
    at: new Date().toISOString(),
    seed: SEED,
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
    const samples = buildSamples(randomTerms(profile, 20));
    expect(samples).toHaveLength(10);
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(OUTPUT_DIR, "samples.json"),
      JSON.stringify(samples, null, 2),
    );

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
    await chooseMode(page);

    for (const [index, sample] of samples.entries()) {
      const human = sample.guidance === "human-led";
      let picked = true;
      let pickedLabel = "";
      if (human) {
        const result = await pickTerm(page, sample.term);
        picked = result.picked;
        pickedLabel = result.label;
        if (!picked) {
          pickedLabel = await pickLatinFallback(page);
          picked = pickedLabel.length > 0;
        }
      } else {
        await clearTerms(page);
      }
      await page.locator('textarea[aria-label="Intent or source prompt"]').fill(sample.intent);

      const runButton = page.getByTestId("orchestrator-run");
      const runDisabled = await runButton.isDisabled();
      console.log(JSON.stringify({
        iteration: index + 1,
        guidance: sample.guidance,
        picked,
        pickedLabel: pickedLabel.slice(0, 60),
        runDisabled,
      }));
      if (runDisabled) {
        const blockers = page.getByTestId("orchestrator-run-blockers");
        console.log("blockers:", (await blockers.count()) > 0 ? await blockers.innerText() : "(none)");
      }
      await runButton.click();
      await expect(page.getByTestId("orchestrator-streaming")).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId("orchestrator-streaming")).toHaveCount(0, {
        timeout: 900_000,
      });

      const decisions = page.getByRole("tab", { name: "Strategy comparison", exact: true });
      await expect(decisions).toBeEnabled({ timeout: 30_000 });
      await decisions.click();
      const panel = page.getByTestId("orchestrator-evidence-panel");
      await expect(panel).toBeVisible({ timeout: 60_000 });
      const strategy = (await page.getByTestId("orchestrator-assembly-strategy").innerText()).trim();
      const rounds = Number(await page.getByTestId("orchestrator-evidence-rounds").innerText());
      const queries = Number(await page.getByTestId("orchestrator-evidence-queries").innerText());
      const candidates = Number(await page.getByTestId("orchestrator-evidence-candidates").innerText());
      const verified = await page.getByTestId("orchestrator-verified-facts").count();
      const missing = await page.getByTestId("orchestrator-missing-facts").count();

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
      expect(completePrompt.length).toBeGreaterThan(30);
      // Many library rows carry Chinese text, so a missing check is not
      // guaranteed; when one appears it must match the warning state.
      if (human && missing > 0) {
        expect(warningText).toContain("Fixed requirement");
      }

      report.runs.push({
        iteration: index + 1,
        guidance: sample.guidance,
        band: sample.band,
        termId: sample.term.id,
        termText: sample.term.en || sample.term.zh,
        picked,
        pickedLabel,
        words: sample.intent.split(/\s+/).length,
        intent: sample.intent,
        completePrompt,
        warnings: warningText,
        degraded,
        toolFallback,
        strategy,
        rounds,
        queries,
        candidates,
        verifiedVisible: verified,
        missingVisible: missing,
      });

      if (index === 0) {
        await resize(app, 1440, 950);
        await decisions.click();
        const evidence = page.getByTestId("orchestrator-evidence-panel");
        await evidence.evaluate((element) => {
          element.scrollIntoView({ block: "start", inline: "center" });
        });
        await page.evaluate(() => new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }));
        await captureAppPage(app, page, path.join(OUTPUT_DIR, "01-random-1440.png"));
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
        await captureAppPage(app, page, path.join(OUTPUT_DIR, "02-random-900.png"));
        await resize(app, 1440, 950);
        await page.getByRole("tab", { name: "Complete prompt", exact: true }).click();
      }
    }

    expect(report.runs).toHaveLength(10);
    report.complete = true;
  } finally {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUTPUT_DIR, "live-runs.json"), JSON.stringify(report, null, 2));
    if (app) {
      await app.evaluate(() => window.api.localLlama.unload().catch(() => undefined)).catch(() => undefined);
      await closePromptHub(app, profile, { preserveUserDataDir: !report.complete });
      if (!report.complete) console.log(`Random ten profile preserved at ${profile}`);
      app = null;
    }
  }
});