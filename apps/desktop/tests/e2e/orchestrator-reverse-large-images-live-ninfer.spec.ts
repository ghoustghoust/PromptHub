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
const OUTPUT_DIR = path.resolve(__dirname, "../../../../outputs/prompt-new-branch1h-20261127");
const COMFY_DIR =
  "D:\\无界工作台AI-Studio\\ComfyUI-Installs\\krea2_image2.1_moss_minimax\\ComfyUI\\output";

const IMAGES = [
  path.join(COMFY_DIR, "VR2-20261109122138_00001_.png"),
  path.join(COMFY_DIR, "upscale_00002_.png"),
  path.join(COMFY_DIR, "Krea2-2ST-20261113152224_00001_.png"),
];

test("reverse mode accepts large exports with no text prompt", async () => {
  test.setTimeout(1_200_000);
  for (const image of IMAGES) expect(fs.existsSync(image)).toBe(true);
  const source = JSON.parse(fs.readFileSync(SOURCE_CONFIG, "utf8")) as LocalLlamaEngineConfig;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prompthub-reverse-large-"));
  const profile = path.join(root, "profile");
  const report: { runs: Array<Record<string, unknown>>; complete: boolean } = {
    runs: [],
    complete: false,
  };
  let app: Awaited<ReturnType<typeof launchPromptHub>>["app"] | null = null;
  try {
    const initialized = await launchPromptHub(null, { userDataDir: profile });
    app = initialized.app;
    await setAppLanguage(initialized.page, "en");
    await initialized.app.close();
    app = null;

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
    await expect(page.getByTestId("orchestrator-writing-layer")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("orchestrator-model-source-local").click();
    const start = page.getByTestId("orchestrator-engine-start");
    if ((await start.count()) > 0) await start.click();
    await expect(page.getByTestId("orchestrator-engine-start")).toHaveCount(0, {
      timeout: 300_000,
    });

    await page
      .getByTestId("orchestrator-config-panel")
      .locator('button[aria-haspopup="listbox"][aria-label="Mode"]')
      .click();
    await page.getByRole("option", { name: "Reverse", exact: true }).click();

    for (const [index, image] of IMAGES.entries()) {
      const clear = page.getByTestId("orchestrator-clear-images");
      if ((await clear.count()) > 0) await clear.click();
      await page.getByTestId("orchestrator-image-file-input").setInputFiles(image);
      await expect(page.getByTestId("orchestrator-clear-images")).toBeVisible({ timeout: 60_000 });
      // No prompt on purpose: reverse must work from the image alone.
      await expect(page.locator('textarea[aria-label="Intent or source prompt"]')).toHaveValue("");

      const before = await page.getByTestId("orchestrator-comparison").count();
      const started = Date.now();
      await page.getByTestId("orchestrator-run").click();
      await expect
        .poll(async () => {
          const comparison = page.getByTestId("orchestrator-comparison");
          if ((await comparison.count()) === 0) return "";
          return (await comparison.locator("button").allInnerTexts()).join(" ").replace(/\s+/g, " ").trim();
        }, { timeout: 240_000 })
        .not.toBe("");
      const elapsedMs = Date.now() - started;

      const comparison = page.getByTestId("orchestrator-comparison");
      const output = (await comparison.locator("button").allInnerTexts())
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      const visualWords = ["woman", "man", "person", "girl", "hair", "face", "portrait", "dress", "standing"];
      const hits = visualWords.filter((word) => output.toLowerCase().includes(word));
      const sizeMb = (fs.statSync(image).size / 1024 / 1024).toFixed(1);

      report.runs.push({
        image: path.basename(image),
        sizeMb: Number(sizeMb),
        elapsedMs,
        output,
        hits,
      });
      console.log(JSON.stringify({
        image: path.basename(image),
        sizeMb,
        elapsedMs,
        length: output.length,
        hits,
      }));

      expect(output.length).toBeGreaterThan(40);
      expect(hits.length).toBeGreaterThanOrEqual(1);
      expect(elapsedMs).toBeLessThan(180_000);
      expect(before).toBeGreaterThanOrEqual(0);
    }

    report.complete = true;
  } finally {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(OUTPUT_DIR, "reverse-large-images.json"),
      JSON.stringify(report, null, 2),
    );
    if (app) {
      await app.evaluate(() => window.api.localLlama.unload().catch(() => undefined)).catch(() => undefined);
      await closePromptHub(app, profile, { preserveUserDataDir: false });
    }
  }
});