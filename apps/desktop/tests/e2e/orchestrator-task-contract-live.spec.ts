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
const OUTPUT_DIR = path.resolve(__dirname, "../../../../outputs/prompt-new-branch1b-20261126");

/** Five inputs that were not used in the previous live run. */
const PROMPTS: Array<{ intent: string; guidance: "agent-led" | "human-led" }> = [
  {
    guidance: "agent-led",
    intent:
      "A clockmaker with scarred hands repairs a pocket watch under a green banker's lamp, brass shavings on the felt, macro detail, warm tungsten key with a cold window rim, no digital screens, no captions.",
  },
  {
    guidance: "agent-led",
    intent:
      "A free diver glides past a submerged bus shelter in a flooded town, shafts of turquoise light, drifting silt, wide lens, one breath only, no air tanks, no fish schools, no text.",
  },
  {
    guidance: "human-led",
    intent:
      "A night librarian stacks returned books in a narrow aisle, one reading lamp on, dust in the beam, muted olive and brown palette, quiet posture, no visitors, no signage.",
  },
  {
    guidance: "agent-led",
    intent:
      "A meteorologist launches a weather balloon from a desert station at dawn, anemometer blurred by wind, sand on the instrument panel, low sun behind the balloon, no aircraft, no logos.",
  },
  {
    guidance: "agent-led",
    intent:
      "A cable-car operator checks the brake wheel of an empty gondola above a snowbound valley, frost on the window, blue hour light, medium close shot, no passengers, no advertising.",
  },
];

async function openOrchestrator(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  const entry = page.getByRole("button", { name: "Prompt Orchestrator", exact: true });
  if ((await entry.count()) > 0) await entry.click();
  await expect(page.getByTestId("orchestrator-writing-layer")).toBeVisible();
}

async function chooseMode(page: Page, label: "Polish" | "Expand"): Promise<void> {
  await page
    .getByTestId("orchestrator-config-panel")
    .locator('button[aria-haspopup="listbox"][aria-label="Mode"]')
    .click();
  await page.getByRole("option", { name: label, exact: true }).click();
}

async function chooseGuidance(
  page: Page,
  label: "Intent-driven · auto compose" | "Term-driven · human decides",
): Promise<void> {
  await page
    .getByTestId("orchestrator-config-panel")
    .locator('button[aria-haspopup="listbox"][aria-label="Who drives the draft"]')
    .click();
  await page.getByRole("option", { name: label, exact: true }).click();
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

test("five new complex prompts publish the same task contract they run under", async () => {
  test.setTimeout(3_600_000);
  const source = JSON.parse(fs.readFileSync(SOURCE_CONFIG, "utf8")) as LocalLlamaEngineConfig;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prompthub-task-contract-live-"));
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
    await chooseGuidance(page, "Intent-driven · auto compose");
    await chooseMode(page, "Polish");
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    let successfulRuns = 0;
    for (const [index, entry] of PROMPTS.entries()) {
      if (entry.guidance === "human-led") {
        await chooseGuidance(page, "Term-driven · human decides");
        // Human-led requires at least one explicit term; pick one through the
        // normal picker so the run uses the same path a user would.
        const categories = page.getByTestId("term-picker-categories");
        if ((await categories.count()) === 0) {
          await page.getByTestId("term-picker-expand").click();
        }
        await page.getByTestId("term-category-clothing").click();
        const chip = page.locator('[data-testid^="term-chip-"]').first();
        await expect(chip).toBeVisible({ timeout: 60_000 });
        await chip.click();
        await expect(page.getByTestId("term-picker-selected")).toBeVisible();
      } else {
        await chooseGuidance(page, "Intent-driven · auto compose");
        const clear = page.getByTestId("term-picker-clear");
        if ((await clear.count()) > 0) await clear.click();
      }
      await page.locator('textarea[aria-label="Intent or source prompt"]').fill(entry.intent);

      // The pre-run summary must exist before the request is sent.
      const compact = page.getByTestId("orchestrator-task-contract");
      await expect(compact).toBeVisible({ timeout: 30_000 });
      const compactText = (await compact.innerText()).replace(/\s+/g, " ").trim();
      expect(compactText).toContain("Creative writing");
      expect(compactText).toContain("resource groups allowed");
      expect(compactText).toContain(
        entry.guidance === "human-led" ? "No model tools" : "Tools on",
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
        await page.getByRole("tab", { name: "Complete prompt", exact: true }).click();
        await expect(page.getByTestId("orchestrator-reuse-intent")).toBeVisible({ timeout: 30_000 });
        const completePrompt = await readGeneratedPrompt(page);
        const warnings = page.getByTestId("orchestrator-warnings");
        const warningText = (await warnings.count()) > 0
          ? (await warnings.innerText()).replace(/\s+/g, " ").trim()
          : "";
        const degraded = warningText.includes("deterministic fallback used");

        await decisions.click();
        const detail = page.getByTestId("orchestrator-task-contract-detail");
        await expect(detail).toBeVisible({ timeout: 30_000 });
        const detailText = (await detail.innerText()).replace(/\s+/g, " ").trim();
        const signature = detailText.match(/#([0-9a-f]{8})/)?.[1] ?? "";

        expect(detailText).toContain("Task contract");
        expect(detailText).toContain("Creative writing");
        expect(detailText).toContain(
          entry.guidance === "human-led"
            ? "Manual selection"
            : "Automatic recall",
        );
        expect(detailText).toContain(
          entry.guidance === "human-led"
            ? "No model tools"
            : "Model tools 4 rounds / 6 calls",
        );
        // Nothing in this UI path supplies input the task refuses, so the
        // ignored-input block must not appear for a clean run.
        expect(detailText).not.toContain("Ignored for this task");
        expect(signature).toMatch(/^[0-9a-f]{8}$/);

        report.runs.push({
          iteration: index + 1,
          attempt,
          guidance: entry.guidance,
          input: entry.intent,
          completePrompt,
          warnings: warningText,
          degraded,
          taskContractSignature: signature,
          taskContractText: detailText,
          compactText,
        });
        completed = !degraded && completePrompt.length > 40;
      }
      expect(completed).toBe(true);
      successfulRuns += 1;

      if (index === 0) {
        await resize(app, 1440, 950);
        await captureAppPage(app, page, path.join(OUTPUT_DIR, "01-task-contract-1440.png"));
        await resize(app, 900, 1200);
        const resultOpen = page.getByTestId("orchestrator-result-open");
        if ((await resultOpen.count()) > 0) await resultOpen.click();
        const resultSlot = page.getByTestId("orchestrator-result-slot");
        await resultSlot.scrollIntoViewIfNeeded();
        const detail = page.getByTestId("orchestrator-task-contract-detail");
        await expect(detail).toBeVisible();
        await detail.evaluate((element) => {
          element.scrollIntoView({ block: "start", inline: "center" });
        });
        await page.evaluate(() => new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }));
        const geometry = await detail.evaluate((element) => {
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
        const narrowOverflow = await resultSlot.evaluate(
          (element) => element.scrollWidth > element.clientWidth + 1,
        );
        expect(narrowOverflow).toBe(false);
        await captureAppPage(app, page, path.join(OUTPUT_DIR, "02-task-contract-900.png"));
        await resize(app, 1440, 950);
        await page.getByRole("tab", { name: "Complete prompt", exact: true }).click();
      }
    }

    expect(successfulRuns).toBe(5);
    // Each run must publish a distinct operating contract, never one shared stub.
    const signatures = new Set(report.runs.map((run) => run.taskContractSignature));
    expect(signatures.size).toBeGreaterThanOrEqual(2);
    report.complete = true;
  } finally {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUTPUT_DIR, "live-runs.json"), JSON.stringify(report, null, 2));
    if (app) {
      await app.evaluate(() => window.api.localLlama.unload().catch(() => undefined)).catch(() => undefined);
      await closePromptHub(app, profile, { preserveUserDataDir: !report.complete });
      if (!report.complete) console.log(`Task contract profile preserved at ${profile}`);
      app = null;
    }
  }
});