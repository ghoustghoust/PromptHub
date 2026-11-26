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
const OUTPUT_DIR = path.resolve(__dirname, "../../../../outputs/prompt-new-branch1c-20261126");

/** Five inputs not used by the earlier live runs. */
const PROMPTS: Array<{ intent: string; guidance: "agent-led" | "human-led" }> = [
  {
    guidance: "agent-led",
    intent:
      "A restorer removes yellowed varnish from a small oil painting, cotton swab and solvent jar on the easel ledge, raking north light, shallow depth of field, no varnish drips, no signature visible.",
  },
  {
    guidance: "human-led",
    intent:
      "A tram conductor in a 1990s style uniform punches a paper ticket in an empty night tram, warm interior lamps against blue street reflections, condensation on the glass, medium shot, no passengers, no route map text.",
  },
  {
    guidance: "agent-led",
    intent:
      "A beekeeper inspects a frame of honeycomb in a wildflower meadow at midday, bees in motion around gloved hands, backlit pollen haze, wide lens, no smoke gun, no written labels.",
  },
  {
    guidance: "human-led",
    intent:
      "A printmaker in a 1990s style work apron pulls a fresh etching from the press, ink on her hands, registration marks on the paper, cool studio light with one warm task lamp, close crop, no gallery visitors.",
  },
  {
    guidance: "agent-led",
    intent:
      "A lighthouse lantern room at dusk: brass gears, curved glass panes, a keeper's logbook closed on the sill, sea mist outside, symmetrical framing, no modern LED fixtures, no readable text.",
  },
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

async function pickExplicitTerm(page: Page): Promise<string> {
  const clear = page.getByTestId("term-picker-clear");
  if ((await clear.count()) > 0) await clear.click();
  const categories = page.getByTestId("term-picker-categories");
  if ((await categories.count()) === 0) {
    await page.getByTestId("term-picker-expand").click();
  }
  // Use a literal English term so the fixed-fact check has something that can
  // legitimately appear word for word in an English prompt.
  const search = page.getByRole("textbox", { name: "Search terms" });
  if ((await search.count()) === 0) {
    await page.getByTestId("term-picker-mode-fields").click();
  }
  await search.fill("1990s style");
  const chip = page.locator('[data-testid^="term-chip-"]').first();
  await expect(chip).toBeVisible({ timeout: 60_000 });
  await chip.click();
  await expect(page.getByTestId("term-picker-selected")).toBeVisible();
  return (await chip.innerText()).replace(/\s+/g, " ").trim();
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

test("five new complex prompts expose assembly and evidence boundaries", async () => {
  test.setTimeout(3_600_000);
  const source = JSON.parse(fs.readFileSync(SOURCE_CONFIG, "utf8")) as LocalLlamaEngineConfig;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prompthub-evidence-live-"));
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

    let successfulRuns = 0;
    const limit = Number(process.env.PROMPTHUB_LIVE_LIMIT ?? PROMPTS.length);
    for (const [index, entry] of PROMPTS.slice(0, limit).entries()) {
      const human = entry.guidance === "human-led";
      await chooseGuidance(page, human);
      let pickedTerm = "";
      if (human) {
        pickedTerm = await pickExplicitTerm(page);
      } else {
        // The picker only mounts for the term-driven panel; show it briefly so
        // the explicit selection from the previous sample can be cleared.
        await chooseGuidance(page, true);
        const clear = page.getByTestId("term-picker-clear");
        if ((await clear.count()) > 0) await clear.click();
        await expect(page.getByTestId("term-picker-selected")).toHaveCount(0, {
          timeout: 10_000,
        });
        await chooseGuidance(page, false);
      }
      await page.locator('textarea[aria-label="Intent or source prompt"]').fill(entry.intent);

      const compact = page.getByTestId("orchestrator-task-contract");
      await expect(compact).toBeVisible({ timeout: 30_000 });
      const compactText = (await compact.innerText()).replace(/\s+/g, " ").trim();
      expect(compactText).toContain(
        human ? "Manual selection" : "Automatic recall",
      );

      let completed = false;
      for (let attempt = 1; attempt <= 2 && !completed; attempt += 1) {
        await page.getByTestId("orchestrator-run").click();
        await expect(page.getByTestId("orchestrator-streaming")).toBeVisible({ timeout: 60_000 });
        await expect(page.getByTestId("orchestrator-streaming")).toHaveCount(0, {
          timeout: 900_000,
        });
        const decisions = page.getByRole("tab", { name: "Strategy comparison", exact: true });
        await expect(decisions).toBeEnabled({ timeout: 30_000 });
        // Wait for the new result before reading anything: the previous run's
        // panel is still mounted and would answer the locators.
        await decisions.click();
        const panel = page.getByTestId("orchestrator-evidence-panel");
        await expect(panel).toBeVisible({ timeout: 60_000 });
        const panelText = (await panel.innerText()).replace(/\s+/g, " ").trim();
        const strategy = (await page.getByTestId("orchestrator-assembly-strategy").innerText()).trim();
        const queryCount = Number(
          await page.getByTestId("orchestrator-evidence-queries").innerText(),
        );
        const candidateCount = Number(
          await page.getByTestId("orchestrator-evidence-candidates").innerText(),
        );
        const modelClaims = (await page.getByTestId("orchestrator-model-claims").innerText()).trim();
        const verifiedVisible = await page.getByTestId("orchestrator-verified-facts").count();
        const missingVisible = await page.getByTestId("orchestrator-missing-facts").count();

        await page.getByRole("tab", { name: "Selected fields", exact: true }).click();
        const warnings = page.getByTestId("orchestrator-warnings");
        const warningText = (await warnings.count()) > 0
          ? ((await warnings.first().textContent()) ?? "").replace(/\s+/g, " ").trim()
          : "";
        await page.getByRole("tab", { name: "Complete prompt", exact: true }).click();
        await expect(page.getByTestId("orchestrator-reuse-intent")).toBeVisible({ timeout: 30_000 });
        const completePrompt = await readGeneratedPrompt(page);
        const degraded = warningText.includes("deterministic fallback used");

        expect(strategy).toBe("Model-written");
        expect(panelText).toContain("Assembly & evidence");
        expect(panelText).toContain("Model rationales are explanations, not proof");
        expect(panelText).toContain("No downstream effect is claimed");
        expect(modelClaims.length).toBeGreaterThan(0);
        expect(Number.isFinite(queryCount)).toBe(true);
        expect(Number.isFinite(candidateCount)).toBe(true);

        // Explicit vocabulary is a machine-checkable fixed requirement.
        if (human) {
          expect(verifiedVisible + missingVisible).toBeGreaterThan(0);
          if (missingVisible > 0) {
            expect(warningText).toContain("Fixed requirement");
          }
        }

        report.runs.push({
          iteration: index + 1,
          attempt,
          guidance: entry.guidance,
          input: entry.intent,
          pickedTerm,
          completePrompt,
          warnings: warningText,
          degraded,
          toolFallback: warningText.includes("Tool retrieval failed"),
          strategy,
          queryCount,
          candidateCount,
          modelClaims,
          verifiedVisible,
          missingVisible,
          evidenceText: panelText,
        });
        completed = !degraded && completePrompt.length > 40;
      }
      expect(completed).toBe(true);
      successfulRuns += 1;

      if (index === 0) {
        await resize(app, 1440, 950);
        await page.getByRole("tab", { name: "Strategy comparison", exact: true }).click();
        const panel = page.getByTestId("orchestrator-evidence-panel");
        await expect(panel).toBeVisible({ timeout: 30_000 });
        await panel.evaluate((element) => {
          element.scrollIntoView({ block: "start", inline: "center" });
        });
        await page.evaluate(() => new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }));
        await captureAppPage(app, page, path.join(OUTPUT_DIR, "01-evidence-1440.png"));
        await resize(app, 900, 1200);
        const resultOpen = page.getByTestId("orchestrator-result-open");
        if ((await resultOpen.count()) > 0) await resultOpen.click();
        const resultSlot = page.getByTestId("orchestrator-result-slot");
        await resultSlot.scrollIntoViewIfNeeded();
        await expect(panel).toBeVisible();
        await panel.evaluate((element) => {
          element.scrollIntoView({ block: "start", inline: "center" });
        });
        await page.evaluate(() => new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }));
        const geometry = await panel.evaluate((element) => {
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
        expect(geometry.left).toBeGreaterThanOrEqual(0);
        expect(geometry.right).toBeLessThanOrEqual(geometry.width);
        expect(geometry.top).toBeGreaterThanOrEqual(0);
        expect(geometry.top).toBeLessThan(geometry.height);
        expect(geometry.bottom).toBeGreaterThan(0);
        const overflow = await resultSlot.evaluate(
          (element) => element.scrollWidth > element.clientWidth + 1,
        );
        expect(overflow).toBe(false);
        await captureAppPage(app, page, path.join(OUTPUT_DIR, "02-evidence-900.png"));
        await resize(app, 1440, 950);
        await page.getByRole("tab", { name: "Complete prompt", exact: true }).click();
      }
    }

    expect(successfulRuns).toBe(5);
    const totalQueries = report.runs.reduce(
      (sum, run) => sum + Number(run.queryCount),
      0,
    );
    expect(totalQueries).toBeGreaterThan(0);
    report.complete = true;
  } finally {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUTPUT_DIR, "live-runs.json"), JSON.stringify(report, null, 2));
    if (app) {
      await app.evaluate(() => window.api.localLlama.unload().catch(() => undefined)).catch(() => undefined);
      await closePromptHub(app, profile, { preserveUserDataDir: !report.complete });
      if (!report.complete) console.log(`Evidence profile preserved at ${profile}`);
      app = null;
    }
  }
});