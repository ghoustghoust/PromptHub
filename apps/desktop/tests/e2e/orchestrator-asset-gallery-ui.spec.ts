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
const OUTPUT_DIR = path.resolve(__dirname, "../../../../outputs/prompt-new-branch1q-20261128");
const LIBRARY_ROOT = path.resolve(
  __dirname,
  "../../../../prompt/library/image-library/models/GHIL",
);

test("asset gallery indexes the default library and browses it", async () => {
  test.setTimeout(900_000);
  const source = JSON.parse(fs.readFileSync(SOURCE_CONFIG, "utf8")) as LocalLlamaEngineConfig;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prompthub-default-library-"));
  const profile = path.join(root, "profile");
  const report: Record<string, unknown> = {};
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  expect(fs.existsSync(path.join(LIBRARY_ROOT, "costume", "data", "costume-zh.json"))).toBe(true);
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
    await page.getByTestId("orchestrator-workspace-tab-gallery").click();

    // Opening the gallery indexes the default folder on its own.
    const gallery = page.getByTestId("orchestrator-asset-gallery");
    await expect(gallery).toBeVisible();
    await expect(page.getByTestId("orchestrator-asset-root")).toContainText("indexed", {
      timeout: 120_000,
    });
    await expect(page.getByTestId("orchestrator-asset-kind-all")).toContainText("5238", {
      timeout: 60_000,
    });
    await expect(page.getByTestId("orchestrator-asset-kind-costume")).toContainText("1407");
    await expect(page.getByTestId("orchestrator-asset-kind-hair")).toContainText("893");
    await expect(page.getByTestId("orchestrator-asset-kind-portrait")).toContainText("1499");
    await expect(page.getByTestId("orchestrator-asset-kind-pose")).toContainText("1439");
    report.counts = {
      all: await page.getByTestId("orchestrator-asset-kind-all").innerText(),
      costume: await page.getByTestId("orchestrator-asset-kind-costume").innerText(),
    };

    const firstCard = page.locator('[data-testid^="orchestrator-asset-card-"]').first();
    await expect(firstCard).toBeVisible({ timeout: 60_000 });
    const thumb = await firstCard
      .locator("img")
      .getAttribute("src", { timeout: 60_000 });
    expect(thumb?.startsWith("data:image/jpeg;base64,")).toBe(true);
    report.thumbnailPrefix = thumb?.slice(0, 32);

    await firstCard.click();
    await expect(page.getByTestId("orchestrator-asset-detail")).toBeVisible();
    report.detailText = (await page.getByTestId("orchestrator-asset-detail").innerText()).slice(0, 160);

    await page.getByTestId("orchestrator-asset-kind-pose").click();
    await expect(page.getByTestId("orchestrator-asset-range")).toContainText("/ 1439");

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
      path.join(OUTPUT_DIR, "asset-gallery-default.png"),
      Buffer.from(shot, "base64"),
    );
    report.ok = true;
  } finally {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(OUTPUT_DIR, "asset-gallery-default.json"),
      JSON.stringify(report, null, 2),
    );
    if (app) await closePromptHub(app, profile, { preserveUserDataDir: false });
  }
});