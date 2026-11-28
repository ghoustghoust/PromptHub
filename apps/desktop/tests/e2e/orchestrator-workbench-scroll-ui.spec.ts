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
const OUTPUT_DIR = path.resolve(__dirname, "../../../../outputs/prompt-new-branch1r-20261128");

test("the term picker keeps a usable height and scrolls at a short window", async () => {
  test.setTimeout(600_000);
  const source = JSON.parse(fs.readFileSync(SOURCE_CONFIG, "utf8")) as LocalLlamaEngineConfig;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prompthub-picker-scroll-"));
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
    // A short window is where the panels above used to squeeze the picker to nothing.
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1180, 700);
    });
    const entry = page.getByRole("button", { name: "Prompt Orchestrator", exact: true });
    if ((await entry.count()) > 0) await entry.click();
    await expect(page.getByTestId("orchestrator-writing-layer")).toBeVisible({ timeout: 60_000 });

    await page.getByRole("button", { name: "Who drives the draft" }).click();
    await page.getByRole("option", { name: /Term-driven/ }).click();
    await expect(page.getByTestId("term-picker")).toBeVisible({ timeout: 30_000 });

    const geometry = await page.evaluate(() => {
      const picker = document.querySelector('[data-testid="term-picker"]') as HTMLElement | null;
      const stack = document.querySelector('[data-testid="orchestrator-flow-stack"]') as HTMLElement | null;
      const pool = document.querySelector('[data-testid="term-picker-pool"]') as HTMLElement | null;
      const workspace = document.querySelector('[data-testid="orchestrator-workspace-scroll"]') as HTMLElement | null;
      const viewport = window.innerHeight;
      return {
        viewport,
        pickerHeight: picker?.clientHeight ?? 0,
        pickerScrollHeight: picker?.scrollHeight ?? 0,
        stackHeight: stack?.getBoundingClientRect().height ?? 0,
        stackScrollable: stack ? stack.scrollHeight > stack.clientHeight : false,
        poolHeight: pool?.clientHeight ?? 0,
        poolScrollHeight: pool?.scrollHeight ?? 0,
        workspaceScrollable: workspace ? workspace.scrollHeight > workspace.clientHeight : false,
      };
    });
    report.geometry = geometry;
    // The picker keeps a real working area, and its whole content is reachable.
    expect(geometry.pickerHeight).toBeGreaterThan(240);
    expect(geometry.stackHeight).toBeLessThanOrEqual(geometry.viewport * 0.55);
    expect(geometry.pickerScrollHeight).toBeGreaterThan(geometry.pickerHeight);
    expect(geometry.workspaceScrollable).toBe(true);

    // Scroll to the end of the picker and select the last chip there.
    await page.getByTestId("term-picker").evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    const lastChip = page.locator('[data-testid^="term-chip-"]').last();
    await lastChip.click();
    await expect(page.getByTestId("term-picker-count")).toContainText("1");
    report.selected = true;

    const shot = await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      const image = await win.webContents.capturePage();
      return image.toPNG().toString("base64");
    });
    fs.writeFileSync(path.join(OUTPUT_DIR, "picker-scroll.png"), Buffer.from(shot, "base64"));
    report.ok = true;
  } finally {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUTPUT_DIR, "picker-scroll.json"), JSON.stringify(report, null, 2));
    if (app) await closePromptHub(app, profile, { preserveUserDataDir: false });
  }
});