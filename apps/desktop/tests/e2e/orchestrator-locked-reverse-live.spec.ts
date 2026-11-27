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
const OUTPUT_DIR = path.resolve(__dirname, "../../../../outputs/prompt-new-branch1g-20261127");

function seed(profile: string): void {
  const dataDir = path.join(profile, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.copyFileSync(SOURCE_DB, path.join(dataDir, "prompthub.db"));
  const db = new DatabaseSync(path.join(dataDir, "prompthub.db"));
  db.exec("DELETE FROM prompt_orchestrator_state");
  db.close();
}

async function chooseOption(page: Page, label: string, option: string): Promise<void> {
  await page
    .getByTestId("orchestrator-config-panel")
    .locator(`button[aria-haspopup="listbox"][aria-label="${label}"]`)
    .click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test("a locked Chinese term in reverse mode is either kept or reported", async () => {
  test.setTimeout(900_000);
  const source = JSON.parse(fs.readFileSync(SOURCE_CONFIG, "utf8")) as LocalLlamaEngineConfig;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prompthub-locked-reverse-"));
  const profile = path.join(root, "profile");
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
    await page.getByTestId("orchestrator-model-source-local").click();
    const start = page.getByTestId("orchestrator-engine-start");
    if ((await start.count()) > 0) await start.click();
    await expect(page.getByTestId("orchestrator-engine-start")).toHaveCount(0, {
      timeout: 300_000,
    });

    await chooseOption(page, "Mode", "Reverse");
    await chooseOption(page, "Who drives the draft", "Term-driven · human decides");

    const categories = page.getByTestId("term-picker-categories");
    if ((await categories.count()) === 0) {
      await page.getByTestId("term-picker-expand").click();
    }
    // A Chinese row, so the check has to decide whether translation counts.
    await page.getByTestId("term-category-clothing").click();
    const chip = page.locator('[data-testid^="term-chip-"]').first();
    await expect(chip).toBeVisible({ timeout: 60_000 });
    const label = (await chip.innerText()).replace(/\s+/g, " ").trim();
    const chipId = (await chip.getAttribute("data-testid"))?.replace("term-chip-", "") ?? "";
    await chip.click();
    await expect(page.getByTestId("term-picker-selected")).toBeVisible();

    const stateSelect = page.getByTestId(`term-state-${chipId}`);
    if ((await stateSelect.count()) > 0) {
      await stateSelect.selectOption("locked");
    }

    await page
      .locator('textarea[aria-label="Intent or source prompt"]')
      .fill("A man in a long dark coat crossing a wet street at night, cinematic lighting");
    await page.getByTestId("orchestrator-run").click();
    // A short run can finish before the streaming indicator paints.
    const decisions = page.getByRole("tab", { name: "Strategy comparison", exact: true });
    await expect(decisions).toBeEnabled({ timeout: 300_000 });

    await decisions.click();
    const panel = page.getByTestId("orchestrator-evidence-panel");
    await expect(panel).toBeVisible({ timeout: 60_000 });
    const verified = await page.getByTestId("orchestrator-verified-facts").count();
    const missing = await page.getByTestId("orchestrator-missing-facts").count();

    await page.getByRole("tab", { name: "Selected fields", exact: true }).click();
    const warnings = page.getByTestId("orchestrator-warnings");
    const warningText = (await warnings.count()) > 0
      ? ((await warnings.first().textContent()) ?? "").replace(/\s+/g, " ").trim()
      : "";
    await page.getByRole("tab", { name: "Complete prompt", exact: true }).click();
    const textareas = page.getByTestId("orchestrator-result-panel").locator("textarea[readonly]");
    const count = await textareas.count();
    const promptText = count > 0 ? await textareas.nth(count - 1).inputValue() : "";
    const comparison = page.getByTestId("orchestrator-comparison");
    const output = (await comparison.count()) > 0
      ? (await comparison.locator("button").allInnerTexts()).join(" ").replace(/\s+/g, " ").trim()
      : promptText;

    const termText = label.replace(/\s+/g, "").slice(0, 4);
    const kept = output.includes(termText);
    const reported = missing > 0 && warningText.includes("Fixed requirement");

    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(OUTPUT_DIR, "locked-reverse.json"),
      JSON.stringify({
        chipId,
        label,
        verified,
        missing,
        kept,
        reported,
        warningText,
        output,
      }, null, 2),
    );
    console.log(JSON.stringify({ chipId, label: label.slice(0, 40), verified, missing, kept, reported }));

    // The promise: a locked term either appears, or the result says it is missing.
    expect(kept || reported).toBe(true);
  } finally {
    if (app) {
      await app.evaluate(() => window.api.localLlama.unload().catch(() => undefined)).catch(() => undefined);
      await closePromptHub(app, profile, { preserveUserDataDir: false });
    }
  }
});