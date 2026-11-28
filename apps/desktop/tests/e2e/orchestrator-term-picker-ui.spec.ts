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
const OUTPUT_DIR = path.resolve(__dirname, "../../../../outputs/prompt-new-branch1p-20261128");

test("term picker lists real vocabulary terms in the term-driven workspace", async () => {
  test.setTimeout(600_000);
  const source = JSON.parse(fs.readFileSync(SOURCE_CONFIG, "utf8")) as LocalLlamaEngineConfig;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prompthub-picker-terms-"));
  const profile = path.join(root, "profile");
  const report: Record<string, unknown> = {};
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
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
    await page.waitForLoadState("domcontentloaded");
    await page.evaluate(async (nextConfig) => {
      await window.api.localLlama.unload().catch(() => undefined);
      await window.api.localLlama.saveConfig(nextConfig);
    }, { ...source, mmprojPath: "" });
    const entry = page.getByRole("button", { name: "Prompt Orchestrator", exact: true });
    if ((await entry.count()) > 0) await entry.click();
    await expect(page.getByTestId("orchestrator-writing-layer")).toBeVisible({ timeout: 60_000 });

    await page.getByRole("button", { name: "Who drives the draft" }).click();
    await page.getByRole("option", { name: /Term-driven/ }).click();
    await page.getByTestId("orchestrator-workspace-tab-picker").click();
    await expect(page.getByTestId("term-picker")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("term-picker-categories")).toBeVisible();

    const chipCount = await page.locator('[data-testid^="term-chip-"]').count();
    report.chipCount = chipCount;
    report.activeCategory = await page
      .getByTestId("term-picker-categories")
      .locator("button[data-active='true']")
      .innerText()
      .catch(() => null);
    report.categoryText = (await page.getByTestId("term-picker-categories").innerText()).slice(0, 200);
    expect(chipCount).toBeGreaterThan(0);

    const shot = await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      const image = await win.webContents.capturePage();
      return image.toPNG().toString("base64");
    });
    fs.writeFileSync(path.join(OUTPUT_DIR, "term-picker.png"), Buffer.from(shot, "base64"));
    report.ok = true;
  } finally {
    fs.writeFileSync(path.join(OUTPUT_DIR, "term-picker.json"), JSON.stringify(report, null, 2));
    if (app) await closePromptHub(app, profile, { preserveUserDataDir: false });
  }
});