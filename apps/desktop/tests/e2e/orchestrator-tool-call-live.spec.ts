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
const OUTPUT_DIR = path.resolve(__dirname, "../../../../outputs/prompt-new-branch1f-20261126");

/** Every sample names several descriptor slots the library can serve. */
const PROMPTS = [
  "A restorer brushes dust from a plaster bust in a cold studio, soft rim light from a tall window, 85mm lens, shallow depth of field, no labels, no modern tools.",
  "A night porter crosses a wet courtyard, warm tungsten lamp above the door, wide angle, long shadows, heavy wool coat, no signage, no vehicles.",
  "A ceramicist centres clay on a wheel, hard side light, close-up on wet hands, apron and rolled sleeves, no studio clutter, no text.",
  "A violinist tunes backstage, single practical bulb, medium shot, seated posture leaning forward, dark curtain background, no audience, no music stands.",
  "A gardener ties a climbing rose in the rain, overcast diffuse light, 50mm lens, hooded raincoat, three-quarter view, no garden furniture, no labels.",
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

test("five prompts really call the vocabulary tools and recall candidates", async () => {
  test.setTimeout(3_600_000);
  const source = JSON.parse(fs.readFileSync(SOURCE_CONFIG, "utf8")) as LocalLlamaEngineConfig;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prompthub-tool-call-live-"));
  const profile = path.join(root, "profile");
  const report: {
    at: string;
    isolatedProfile: boolean;
    vocabularyCount: number;
    complete: boolean;
    callsWithQueries: number;
    runs: Array<Record<string, unknown>>;
  } = {
    at: new Date().toISOString(),
    isolatedProfile: true,
    vocabularyCount: 0,
    complete: false,
    callsWithQueries: 0,
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
    }, { ...source, mmprojPath: "", contextSize: 32768 });

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
      const rounds = Number(await page.getByTestId("orchestrator-evidence-rounds").innerText());
      const queries = Number(await page.getByTestId("orchestrator-evidence-queries").innerText());
      const candidates = Number(await page.getByTestId("orchestrator-evidence-candidates").innerText());
      const modelDecisions = Number(
        await page.getByTestId("orchestrator-evidence-modelDecisions").innerText(),
      );

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
      console.log(JSON.stringify({
        iteration: index + 1,
        rounds,
        queries,
        candidates,
        modelDecisions,
        toolFallback,
        degraded,
        warning: warningText.slice(0, 220),
      }));
      expect(degraded).toBe(false);
      expect(completePrompt.length).toBeGreaterThan(30);
      // The run must show real retrieval evidence: either the tool stage ran or
      // the fallback polish stage did. Zero-evidence runs are counted as misses.
      const retrieved = rounds > 0 && queries > 0 && candidates > 0;
      if (retrieved) report.callsWithQueries += 1;

      report.runs.push({
        iteration: index + 1,
        input: intent,
        completePrompt,
        warnings: warningText.slice(0, 400),
        degraded,
        toolFallback,
        rounds,
        queries,
        candidates,
        modelDecisions,
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
        await captureAppPage(app, page, path.join(OUTPUT_DIR, "01-tool-call-1440.png"));
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
        await captureAppPage(app, page, path.join(OUTPUT_DIR, "02-tool-call-900.png"));
        await resize(app, 1440, 950);
        await page.getByRole("tab", { name: "Complete prompt", exact: true }).click();
      }
    }

    expect(report.callsWithQueries).toBeGreaterThanOrEqual(4);
    report.complete = true;
  } finally {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUTPUT_DIR, "live-runs.json"), JSON.stringify(report, null, 2));
    if (app) {
      await app.evaluate(() => window.api.localLlama.unload().catch(() => undefined)).catch(() => undefined);
      await closePromptHub(app, profile, { preserveUserDataDir: !report.complete });
      if (!report.complete) console.log(`Tool call profile preserved at ${profile}`);
      app = null;
    }
  }
});