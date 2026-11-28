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
const IMAGE = path.join(
  "G:\\program\\3.prompt-forge",
  "prompt",
  "new",
  "【014】加载图库节点+服装、发型、姿势、人像等6000套素材",
  "models",
  "GHIL",
  "portrait",
  "thumbs",
  "f000a1c4200.webp",
);
const OUTPUT_DIR = path.resolve(__dirname, "../../../../outputs/prompt-new-branch1h-20261127");

test("reverse mode reads a portrait thumbnail", async () => {
  test.setTimeout(900_000);
  expect(fs.existsSync(IMAGE)).toBe(true);
  const source = JSON.parse(fs.readFileSync(SOURCE_CONFIG, "utf8")) as LocalLlamaEngineConfig;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prompthub-reverse-thumb-"));
  const profile = path.join(root, "profile");
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

    await page.getByTestId("orchestrator-image-file-input").setInputFiles(IMAGE);
    await expect(page.getByTestId("orchestrator-clear-images")).toBeVisible({ timeout: 60_000 });
    await page
      .locator('textarea[aria-label="Intent or source prompt"]')
      .fill("Describe the person in the photo.");

    const contract = page.getByTestId("orchestrator-task-contract");
    const contractText = (await contract.count()) > 0
      ? (await contract.innerText()).replace(/\s+/g, " ").trim()
      : "";
    expect(contractText).toContain("No model tools");

    const started = Date.now();
    await page.getByTestId("orchestrator-run").click();
    await expect
      .poll(async () => {
        const comparison = page.getByTestId("orchestrator-comparison");
        if ((await comparison.count()) === 0) return "";
        return (await comparison.locator("button").allInnerTexts()).join(" ").replace(/\s+/g, " ").trim();
      }, { timeout: 300_000 })
      .not.toBe("");
    const elapsedMs = Date.now() - started;

    const comparison = page.getByTestId("orchestrator-comparison");
    const output = (await comparison.locator("button").allInnerTexts())
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    const visualWords = ["woman", "man", "person", "girl", "boy", "hair", "face", "portrait", "expression"];
    const hits = visualWords.filter((word) => output.toLowerCase().includes(word));

    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(OUTPUT_DIR, "reverse-image.json"),
      JSON.stringify({ image: IMAGE, elapsedMs, output, hits, contractText }, null, 2),
    );
    console.log(JSON.stringify({ elapsedMs, length: output.length, hits }));

    expect(output.length).toBeGreaterThan(40);
    expect(hits.length).toBeGreaterThanOrEqual(2);
  } finally {
    if (app) {
      await app.evaluate(() => window.api.localLlama.unload().catch(() => undefined)).catch(() => undefined);
      await closePromptHub(app, profile, { preserveUserDataDir: false });
    }
  }
});