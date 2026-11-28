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
const OUTPUT_DIR = path.resolve(__dirname, "../../../../outputs/prompt-new-branch1k-20261128");

const OUTLINE = "A courier crosses a wet market street at midnight with a sealed envelope.";
const OUTLINE_V2 = "A courier crosses a flooded market street at 2 a.m., envelope tucked inside the coat.";
const SCRIPT = "INT. MARKET STREET - NIGHT\nRain on the awning. The courier stops, checks the envelope seal.";

test("script stages switch, keep versions and survive reload", async () => {
  test.setTimeout(600_000);
  const source = JSON.parse(fs.readFileSync(SOURCE_CONFIG, "utf8")) as LocalLlamaEngineConfig;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prompthub-script-flow-"));
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
    await page.evaluate(async (nextConfig) => {
      await window.api.localLlama.unload().catch(() => undefined);
      await window.api.localLlama.saveConfig(nextConfig);
    }, { ...source, mmprojPath: "" });
    await page.waitForLoadState("domcontentloaded");
    const entry = page.getByRole("button", { name: "Prompt Orchestrator", exact: true });
    if ((await entry.count()) > 0) await entry.click();
    try {
      await expect(page.getByTestId("orchestrator-writing-layer")).toBeVisible({ timeout: 60_000 });
    } catch (error) {
      const body = await page.locator("body").innerText().catch(() => "<no body>");
      await page.screenshot({ path: path.join(OUTPUT_DIR, "script-flow-open-failed.png") });
      console.error("PAGE TEXT:", body.slice(0, 1500));
      throw error;
    }

    await page.getByTestId("orchestrator-script-flow-toggle").click();
    await expect(page.getByTestId("orchestrator-script-stage-outline")).toHaveAttribute(
      "data-status",
      "next",
    );
    await expect(page.getByTestId("orchestrator-script-stage-storyboard")).toHaveAttribute(
      "data-status",
      "empty",
    );

    // The scene shot count is a flow setting: it must come back after a reload
    // instead of resetting to the default.
    await page.getByTestId("orchestrator-script-shot-count").fill("9");
    await expect(page.getByTestId("orchestrator-script-shot-count")).toHaveValue("9");

    await page.getByTestId("orchestrator-script-draft").fill(OUTLINE);
    await page.getByTestId("orchestrator-script-save").click();
    await expect(page.getByTestId("orchestrator-script-stage-outline")).toHaveAttribute(
      "data-status",
      "done",
    );
    await expect(page.getByTestId("orchestrator-script-stage-script")).toHaveAttribute(
      "data-status",
      "next",
    );

    await page.getByTestId("orchestrator-script-stage-script").click();
    await page.getByTestId("orchestrator-script-draft").fill(SCRIPT);
    await page.getByTestId("orchestrator-script-save").click();
    await expect(page.getByTestId("orchestrator-script-load-1")).toBeVisible();

    await page.getByTestId("orchestrator-script-stage-outline").click();
    await page.getByTestId("orchestrator-script-draft").fill(OUTLINE_V2);
    await page.getByTestId("orchestrator-script-save").click();
    await expect(page.getByTestId("orchestrator-script-load-2")).toBeVisible();
    await expect(page.getByTestId("orchestrator-script-load-1")).toBeVisible();
    await expect(page.getByTestId("orchestrator-script-stage-script")).toHaveAttribute(
      "data-status",
      "stale",
    );

    await page.getByTestId("orchestrator-script-load-2").click();
    await page.getByTestId("orchestrator-step-context-toggle").click();
    await expect(page.getByTestId("orchestrator-step-context-input")).toHaveValue(OUTLINE_V2);
    await expect(page.getByTestId("orchestrator-intent")).not.toHaveValue(OUTLINE_V2);
// Playwright's CDP screenshot can stall on this window; capture natively.
    const panelShot = await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      const image = await win.webContents.capturePage();
      return image.toPNG().toString("base64");
    });
    fs.writeFileSync(
      path.join(OUTPUT_DIR, "script-flow-panel.png"),
      Buffer.from(panelShot, "base64"),
    );
    report.versionsAfterEdit = 2;

    await page.waitForTimeout(1_000);
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    const reentry = page.getByRole("button", { name: "Prompt Orchestrator", exact: true });
    if ((await reentry.count()) > 0) await reentry.click();
    await expect(page.getByTestId("orchestrator-script-flow-toggle")).toBeVisible({
      timeout: 60_000,
    });
    await page.getByTestId("orchestrator-script-flow-toggle").click();
    await expect(page.getByTestId("orchestrator-script-stage-outline")).toHaveAttribute(
      "data-status",
      "done",
    );
    await expect(page.getByTestId("orchestrator-script-stage-script")).toHaveAttribute(
      "data-status",
      "stale",
    );
    await expect(page.getByTestId("orchestrator-script-stage-storyboard")).toHaveAttribute(
      "data-status",
      "empty",
    );
    await page.getByTestId("orchestrator-script-stage-outline").click();
    await expect(page.getByTestId("orchestrator-script-load-2")).toBeVisible();
    await expect(page.getByTestId("orchestrator-script-shot-count")).toHaveValue("9");
    report.persisted = true;
  } finally {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(OUTPUT_DIR, "script-flow-ui.json"),
      JSON.stringify(report, null, 2),
    );
    if (app) await closePromptHub(app, profile, { preserveUserDataDir: false });
  }
});