import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test, type Page } from "@playwright/test";
import type { LocalLlamaEngineConfig } from "@prompthub/shared/types";
import { closePromptHub, launchPromptHub, setAppLanguage } from "./helpers/electron";

const SOURCE_CONFIG = path.join(
  process.env.TEMP ?? "C:\\Windows\\Temp",
  "qwenwork",
  "PromptHub-native-manual-test",
  "profile-ninfer",
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
const OUTPUT_DIR = path.resolve(__dirname, "../../../../outputs/prompt-new-branch1h-20261127");

/** Five inputs of different length and content, none used in earlier runs. */
const PROMPTS = [
  "A diver checks a pressure gauge in green water, hard side light.",
  "A watchmaker oils a movement at a cluttered bench, warm task lamp, 100mm macro lens, brass dust, no digital tools.",
  "Two glassblowers shape a vase at a furnace mouth, orange core light against a cold workshop, wide angle from floor level, heat shimmer, protective sleeves, no spectators, no text, keep the cramped framing and do not add extra workers.",
  "A florist trims stems behind a rain-streaked window, soft overcast light, 50mm lens, paper wrap and wet counter, no customers, no price tags.",
  "An archivist lifts a brittle map from a plan chest, single overhead fixture, white cotton gloves, dust in the beam, symmetrical framing, no visitors, no labels or numbers, preserve the paper texture and avoid adding furniture.",
];

function seed(profile: string): void {
  const dataDir = path.join(profile, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.copyFileSync(SOURCE_DB, path.join(dataDir, "prompthub.db"));
  const db = new DatabaseSync(path.join(dataDir, "prompthub.db"));
  db.exec("DELETE FROM prompt_orchestrator_state");
  db.close();
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/[()[\]{}]/g, " ")
    .replace(/[,;\u3001\uFF0C\uFF1B]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function choosePolish(page: Page): Promise<void> {
  await page
    .getByTestId("orchestrator-config-panel")
    .locator('button[aria-haspopup="listbox"][aria-label="Mode"]')
    .click();
  await page.getByRole("option", { name: "Polish", exact: true }).click();
}

async function readOutput(page: Page): Promise<string> {
  const comparison = page.getByTestId("orchestrator-comparison");
  if ((await comparison.count()) > 0) {
    return (await comparison.locator("button").allInnerTexts()).join(" ").replace(/\s+/g, " ").trim();
  }
  const textareas = page.getByTestId("orchestrator-result-panel").locator("textarea[readonly]");
  const count = await textareas.count();
  return count > 0 ? (await textareas.nth(count - 1).inputValue()).trim() : "";
}

test("five new prompts show whether retrieved candidates are actually used", async () => {
  test.setTimeout(2_700_000);
  const source = JSON.parse(fs.readFileSync(SOURCE_CONFIG, "utf8")) as LocalLlamaEngineConfig;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prompthub-candidate-usage-"));
  const profile = path.join(root, "profile");
  const report: {
    at: string;
    runs: Array<Record<string, unknown>>;
    complete: boolean;
  } = { at: new Date().toISOString(), runs: [], complete: false };
  let app: Awaited<ReturnType<typeof launchPromptHub>>["app"] | null = null;
  try {
    const initialized = await launchPromptHub(null, { userDataDir: profile });
    app = initialized.app;
    await setAppLanguage(initialized.page, "en");
    await initialized.app.close();
    app = null;

    seed(profile);
    const launched = await launchPromptHub(null, { userDataDir: profile });
    app = launched.app;
    const page = launched.page;
    await setAppLanguage(page, "en");
    await page.evaluate(async (nextConfig) => {
      await window.api.localLlama.unload().catch(() => undefined);
      await window.api.localLlama.saveConfig(nextConfig);
    }, { ...source, mmprojPath: "" });
    await page.waitForLoadState("domcontentloaded");
    const entry = page.getByRole("button", { name: "Prompt Orchestrator", exact: true });
    if ((await entry.count()) > 0) await entry.click();
    await expect(page.getByTestId("orchestrator-writing-layer")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("orchestrator-model-source-local").click();
    const start = page.getByTestId("orchestrator-engine-start");
    if ((await start.count()) > 0) await start.click();
    await expect(page.getByTestId("orchestrator-engine-start")).toHaveCount(0, {
      timeout: 300_000,
    });
    await choosePolish(page);
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    const limit = Number(process.env.PROMPTHUB_CANDIDATE_LIMIT ?? PROMPTS.length);
    for (const [index, intent] of PROMPTS.slice(0, limit).entries()) {
      await page.locator('textarea[aria-label="Intent or source prompt"]').fill(intent);
      const compact = page.getByTestId("orchestrator-task-contract");
      const compactText = (await compact.count()) > 0
        ? (await compact.innerText()).replace(/\s+/g, " ").trim()
        : "";
      const modeButton = page
        .getByTestId("orchestrator-config-panel")
        .locator('button[aria-haspopup="listbox"][aria-label="Mode"]');
      const modeText = (await modeButton.count()) > 0 ? (await modeButton.innerText()).trim() : "";
      const formatButton = page
        .getByTestId("orchestrator-config-panel")
        .locator('button[aria-haspopup="listbox"][aria-label="Output format"]');
      const formatText = (await formatButton.count()) > 0 ? (await formatButton.innerText()).trim() : "";
      const intentValue = await page
        .locator('textarea[aria-label="Intent or source prompt"]')
        .inputValue();
      // The panel keeps the previous result mounted; wait for this run's output
      // instead of trusting the tab state.
      await page.getByRole("tab", { name: "Complete prompt", exact: true }).click().catch(() => undefined);
      const beforeText = await readOutput(page).catch(() => "");
      await page.getByTestId("orchestrator-run").click();
      await expect
        .poll(async () => {
          const current = await readOutput(page).catch(() => "");
          return current.length > 0 && current !== beforeText;
        }, { timeout: 600_000 })
        .toBe(true);
      const decisionsTab = page.getByRole("tab", { name: "Strategy comparison", exact: true });
      await expect(decisionsTab).toBeEnabled({ timeout: 300_000 });

      await decisionsTab.click();
      const evidenceRounds = Number(
        await page.getByTestId("orchestrator-evidence-rounds").innerText().catch(() => "0"),
      );
      const evidenceQueries = Number(
        await page.getByTestId("orchestrator-evidence-queries").innerText().catch(() => "0"),
      );
      const evidenceCandidates = Number(
        await page.getByTestId("orchestrator-evidence-candidates").innerText().catch(() => "0"),
      );
      const trace = page.getByTestId("retrieval-trace");
      const hasTrace = (await trace.count()) > 0;
      const toggles = page.locator('[data-testid^="retrieval-query-toggle-"]');
      const toggleCount = await toggles.count();
      for (let i = 0; i < toggleCount; i += 1) {
        await toggles.nth(i).click();
      }
      const candidateRows = page.locator('[data-testid^="retrieval-candidate-"]');
      const candidateCount = await candidateRows.count();
      const candidates: Array<{ id: string; en: string }> = [];
      for (let i = 0; i < candidateCount; i += 1) {
        const row = candidateRows.nth(i);
        const testId = (await row.getAttribute("data-testid")) ?? "";
        const en = (await row.locator("span.font-medium").first().innerText().catch(() => ""))
          .replace(/\s+/g, " ")
          .trim();
        if (en) candidates.push({ id: testId.replace("retrieval-candidate-", ""), en });
      }

      const decisionCards = page.locator('[data-testid^="orchestrator-decision-"]');
      const decisionCount = await decisionCards.count();
      const citedIds: string[] = [];
      for (let i = 0; i < decisionCount; i += 1) {
        const titles = await decisionCards.nth(i).locator("[title]").evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute("title") ?? ""));
        citedIds.push(...titles.filter((value) => value.length > 0));
      }

      await page.getByRole("tab", { name: "Complete prompt", exact: true }).click();
      const output = await readOutput(page);
      const normalizedOutput = normalize(output);

      const used: Array<{ id: string; en: string; via: string }> = [];
      for (const candidate of candidates) {
        const normalized = normalize(candidate.en);
        if (normalized.length < 3) continue;
        if (citedIds.includes(candidate.id)) {
          used.push({ ...candidate, via: "decision" });
          continue;
        }
        if (normalizedOutput.includes(normalized)) {
          used.push({ ...candidate, via: "text" });
        }
      }

      await page.getByRole("tab", { name: "Selected fields", exact: true }).click();
      const warnings = page.getByTestId("orchestrator-warnings");
      const warningText = (await warnings.count()) > 0
        ? ((await warnings.first().textContent()) ?? "").replace(/\s+/g, " ").trim()
        : "";
      const run = {
        iteration: index + 1,
        intent,
        words: intent.split(/\s+/).length,
        output,
        outputLength: output.length,
        hasTrace,
        compactText,
        intentValue,
        modeText,
        formatText,
        evidenceRounds,
        evidenceQueries,
        evidenceCandidates,
        candidateCount: candidates.length,
        decisionCount,
        citedCount: citedIds.length,
        usedCount: used.length,
        used,
        candidates: candidates.slice(0, 8),
        warnings: warningText.slice(0, 600),
      };
      report.runs.push(run);
      console.log(JSON.stringify({
        iteration: run.iteration,
        words: run.words,
        candidates: run.candidateCount,
        decisions: run.decisionCount,
        used: run.usedCount,
        via: run.used.map((item) => item.via),
      }));

      expect(output.length).toBeGreaterThan(30);
    }

    const runsWithUse = report.runs.filter((run) => Number(run.usedCount) > 0).length;
    const retrievedRuns = report.runs.filter((run) => Number(run.candidateCount) > 0).length;
    report.complete = true;
    fs.writeFileSync(path.join(OUTPUT_DIR, "candidate-usage.json"), JSON.stringify(report, null, 2));
    expect(retrievedRuns).toBeGreaterThanOrEqual(1);
    expect(runsWithUse).toBeGreaterThanOrEqual(2);
  } finally {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    if (!report.complete) {
      fs.writeFileSync(path.join(OUTPUT_DIR, "candidate-usage.json"), JSON.stringify(report, null, 2));
    }
    if (app) {
      await app.evaluate(() => window.api.localLlama.unload().catch(() => undefined)).catch(() => undefined);
      await closePromptHub(app, profile, { preserveUserDataDir: false });
    }
  }
});