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
const OUTPUT_DIR = path.resolve(__dirname, "../../../../outputs/prompt-new-branch1n-20261128");

const SCRIPT = [
  "EXT. 雨夜市场街 - 夜",
  "雨砸在铁皮棚上。信使抱着牛皮纸信封走进来，停在空摊位前。",
  "信使：我到了，你还没来。",
].join("\n");

test("storyboard result renders as a six-column table in the real window", async () => {
  test.setTimeout(900_000);
  const source = JSON.parse(fs.readFileSync(SOURCE_CONFIG, "utf8")) as LocalLlamaEngineConfig;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prompthub-storyboard-table-ui-"));
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
    await page.getByTestId("orchestrator-model-source-local").click();
    const start = page.getByTestId("orchestrator-engine-start");
    if ((await start.count()) > 0) await start.click();
    await expect(page.getByTestId("orchestrator-engine-start")).toHaveCount(0, {
      timeout: 300_000,
    });

    // The storyboard stage only applies inside a script flow, so create the two
    // upstream versions first, then work on the storyboard stage.
    await page.getByTestId("orchestrator-script-flow-toggle").click();
    await page.getByTestId("orchestrator-script-draft").fill("信使雨夜送信，收信人不在，他决定等。");
    await page.getByTestId("orchestrator-script-save").click();
    await page.getByTestId("orchestrator-script-stage-script").click();
    await page.getByTestId("orchestrator-script-draft").fill(SCRIPT);
    await page.getByTestId("orchestrator-script-save").click();
    await page.getByTestId("orchestrator-script-stage-storyboard").click();
    await page.getByTestId("orchestrator-script-shot-count").fill("4");
    await expect(page.getByTestId("orchestrator-script-shot-count")).toHaveValue("4");

    await page.getByTestId("orchestrator-intent").fill("把上面的剧本拆成分镜，对白放在他开口的那一镜。");
    await page.getByTestId("orchestrator-run").click();
    await expect(page.getByTestId("orchestrator-result-panel")).toBeVisible({ timeout: 240_000 });
    await expect(page.getByTestId("orchestrator-storyboard-table")).toBeVisible({
      timeout: 60_000,
    });

    const table = page.getByTestId("orchestrator-storyboard-table");
    await expect(table.getByRole("columnheader")).toHaveCount(6);
    const rowCount = await table.getByTestId(/orchestrator-storyboard-row-/).count();
    expect(rowCount).toBeGreaterThan(0);
    report.rowCount = rowCount;
    report.columns = await table.getByRole("columnheader").allInnerTexts();
    report.firstRowText = await table
      .getByTestId("orchestrator-storyboard-row-1")
      .innerText()
      .catch(() => null);

    // The table must not push the page into a horizontal scrollbar.
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    report.overflow = overflow;
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);

    const shot = await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      const image = await win.webContents.capturePage();
      return image.toPNG().toString("base64");
    });
    fs.writeFileSync(
      path.join(OUTPUT_DIR, "storyboard-table-result.png"),
      Buffer.from(shot, "base64"),
    );
    report.ok = true;
  } finally {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(OUTPUT_DIR, "storyboard-table-ui.json"),
      JSON.stringify(report, null, 2),
    );
    if (app) {
      await app
        .evaluate(() => window.api.localLlama.unload().catch(() => undefined))
        .catch(() => undefined);
      await closePromptHub(app, profile, { preserveUserDataDir: false });
    }
  }
});