import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
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
const OUTPUT_DIR = path.resolve(__dirname, "../../../../outputs/prompt-new-branch1j-20261127");

const FACTS = {
  subject: "a courier holding a sealed envelope",
  action: "shaking rain from the envelope",
  setting: "a narrow street after midnight",
  lighting: "one warm practical on wet asphalt",
  continuity: "same coat and envelope as the previous shot",
};

test("shared facts entered in the workbench reach the model and survive reload", async () => {
  test.setTimeout(1_800_000);
  const source = JSON.parse(fs.readFileSync(SOURCE_CONFIG, "utf8")) as LocalLlamaEngineConfig;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prompthub-shared-ui-"));
  const profile = path.join(root, "profile");
  const report: { runs: Array<Record<string, unknown>>; persisted: boolean } = {
    runs: [],
    persisted: false,
  };
  let app: Awaited<ReturnType<typeof launchPromptHub>>["app"] | null = null;
  try {
    const initialized = await launchPromptHub(null, { userDataDir: profile });
    await setAppLanguage(initialized.page, "en");
    await initialized.app.close();

    const dataDir = path.join(profile, "data");
    fs.mkdirSync(dataDir, { recursive: true });
    fs.copyFileSync(SOURCE_DB, path.join(dataDir, "prompthub.db"));

    const launched = await launchPromptHub(null, { userDataDir: profile });
    app = launched.app;
    const page = launched.page;
    await setAppLanguage(page, "en");
    await page.evaluate(async (nextConfig) => {
      await window.api.localLlama.unload().catch(() => undefined);
      await window.api.localLlama.saveConfig(nextConfig);
    }, { ...source, mmprojPath: "" });
    const entry = page.getByRole("button", { name: "Prompt Orchestrator", exact: true });
    if ((await entry.count()) > 0) await entry.click();
    await expect(page.getByTestId("orchestrator-writing-layer")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("orchestrator-model-source-local").click();
    const start = page.getByTestId("orchestrator-engine-start");
    if ((await start.count()) > 0) await start.click();
    await expect(page.getByTestId("orchestrator-engine-start")).toHaveCount(0, {
      timeout: 300_000,
    });

    await page.getByTestId("orchestrator-shared-facts-toggle").click();
    await page.getByTestId("orchestrator-shared-subject").fill(FACTS.subject);
    await page.getByTestId("orchestrator-shared-action").fill(FACTS.action);
    await page.getByTestId("orchestrator-shared-setting").fill(FACTS.setting);
    await page.getByTestId("orchestrator-shared-lighting").fill(FACTS.lighting);
    await page.getByTestId("orchestrator-shared-continuity").fill(FACTS.continuity);
    await expect(page.getByTestId("orchestrator-shared-facts")).toContainText("5 filled");

    await page.getByTestId("orchestrator-intent").fill(
      "A courier waits under a street lamp in the rain.",
    );

    for (const sample of [
      { label: "moss", option: "MOSS-Image (official guide)" },
      { label: "k2", option: "Krea 2 / K2" },
    ]) {
      await page.getByRole("button", { name: "Rule card" }).click();
      await page.getByRole("option", { name: sample.option, exact: true }).click();
      const before = await page
        .getByTestId("orchestrator-result-panel")
        .innerText()
        .catch(() => "");
      const started = Date.now();
      await page.getByTestId("orchestrator-run").click();
      await expect(page.getByTestId("orchestrator-run")).toBeEnabled({ timeout: 600_000 });
      await expect(page.getByTestId("orchestrator-result-panel")).toBeVisible({ timeout: 60_000 });
      const after = await page.getByTestId("orchestrator-result-panel").innerText();
      expect(after).not.toBe(before);
      const lowered = after.toLowerCase();
      const hits = ["courier", "envelope", "street"].filter((fact) => lowered.includes(fact));
      expect(hits.length).toBeGreaterThanOrEqual(1);
      report.runs.push({
        label: sample.label,
        elapsedMs: Date.now() - started,
        outputLength: after.length,
        facts: hits,
      });
      console.log(JSON.stringify({ label: sample.label, elapsedMs: Date.now() - started, hits }));
    }

    await page.waitForTimeout(1_500);
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    const reentry = page.getByRole("button", { name: "Prompt Orchestrator", exact: true });
    if ((await reentry.count()) > 0) await reentry.click();
    await expect(page.getByTestId("orchestrator-shared-facts")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("orchestrator-shared-facts")).toContainText("5 filled");
    await page.getByTestId("orchestrator-shared-facts-toggle").click();
    await expect(page.getByTestId("orchestrator-shared-subject")).toHaveValue(FACTS.subject);
    await expect(page.getByTestId("orchestrator-shared-continuity")).toHaveValue(
      FACTS.continuity,
    );
    report.persisted = true;
  } finally {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(OUTPUT_DIR, "shared-facts-ui.json"),
      JSON.stringify(report, null, 2),
    );
    if (app) {
      await app.evaluate(() => window.api.localLlama.unload().catch(() => undefined)).catch(() => undefined);
      await closePromptHub(app, profile, { preserveUserDataDir: false });
    }
  }
});