import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { LocalLlamaEngineConfig } from "@prompthub/shared/types";

import { captureAppPage, launchPromptHub, setAppLanguage } from "./helpers/electron";

const PROFILE = path.join(
  process.env.TEMP ?? "C:\\Windows\\Temp",
  "qwenwork",
  "PromptHub-native-manual-test",
  "profile",
);
const LOCAL_CONFIG = path.join(PROFILE, "config", "local-llama.json");
const REPO = path.resolve(__dirname, "../../../..");
const OUTPUT_DIR = path.join(REPO, "outputs", "a6-phase2-20261125");
const PACKS = [
  {
    name: "老唐电影级分镜 s9",
    root: path.join(REPO, "prompt/new/压缩包版本+老唐电影级分镜skill-s9/老唐电影级分镜skill-s9"),
    traceTitle: "版本与适用范围",
    intent: "Storyboard a 30-second chase through a rainy neon alley.",
  },
  {
    name: "斯坦尼斯拉夫斯基（Kimi 规范版）",
    root: path.join(
      REPO,
      "prompt/new/斯坦尼斯拉夫斯基表演体系skill/斯坦尼斯拉夫斯基表演体系skill/Kimi最终稿",
    ),
    traceTitle: "剧本篇 · 一、公共坐标",
    intent: "A young actress auditions for a role; write the scene around her objective.",
  },
];

async function openOrchestrator(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  const entry = page.getByRole("button", { name: "Prompt Orchestrator", exact: true });
  if ((await entry.count()) > 0) await entry.click();
  await expect(page.getByTestId("orchestrator-writing-layer")).toBeVisible();
}

async function readGeneratedPrompt(page: Page): Promise<string> {
  const comparison = page.getByTestId("orchestrator-comparison");
  if ((await comparison.count()) > 0) {
    const parts = await comparison.locator("button").allInnerTexts();
    return parts.join(" ").replace(/\s+/g, " ").trim();
  }
  const textareas = page.getByTestId("orchestrator-result-panel").locator("textarea[readonly]");
  const count = await textareas.count();
  if (count === 0) return "";
  const values = await textareas.evaluateAll((nodes) =>
    nodes.map((node) => (node as HTMLTextAreaElement).value.trim()).filter(Boolean));
  return values.sort((left, right) => right.length - left.length)[0] ?? "";
}

test("runs s9 and Stanislavski contracts with a 32K context", async () => {
  test.setTimeout(1_800_000);
  const config = JSON.parse(fs.readFileSync(LOCAL_CONFIG, "utf8")) as LocalLlamaEngineConfig;
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "prompthub-e2e-contract-32k-"));
  let launched: Awaited<ReturnType<typeof launchPromptHub>> | null = null;
  try {
    launched = await launchPromptHub(null, { userDataDir });
    await setAppLanguage(launched.page, "en");
    await launched.page.evaluate(async (nextConfig) => {
      await window.api.localLlama.unload().catch(() => undefined);
      await window.api.localLlama.saveConfig(nextConfig);
    }, { ...config, mmprojPath: "", contextSize: 32768 });

    await openOrchestrator(launched.page);
    for (const pack of PACKS) {
      await launched.page.evaluate(async ({ rootPath, name }) => {
        const preview = await window.api.promptKnowledge.previewPack({ rootPath });
        if (preview.ok !== true) throw new Error(preview.error.message);
        const result = await window.api.promptKnowledge.commitImport({
          preview: preview.data,
          packName: name,
        });
        if (result.ok !== true) throw new Error(result.error.message);
      }, { rootPath: pack.root, name: pack.name });
    }

    await launched.page.reload();
    await openOrchestrator(launched.page);
    await launched.page.getByTestId("orchestrator-model-source-local").click();
    const startButton = launched.page.getByTestId("orchestrator-engine-start");
    if ((await startButton.count()) > 0) await startButton.click();
    try {
      await expect(launched.page.getByTestId("orchestrator-engine-start")).toHaveCount(0, {
        timeout: 300_000,
      });
    } catch (error) {
      const status = await launched.page.evaluate(() => window.api.localLlama.getStatus());
      const log = await launched.page.evaluate(() => window.api.localLlama.readLog());
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
      fs.writeFileSync(
        path.join(OUTPUT_DIR, "live-contract-32k-failure.json"),
        JSON.stringify({ at: new Date().toISOString(), status, log: log.slice(-12000) }, null, 2),
        "utf8",
      );
      throw error;
    }

    await expect
      .poll(async () => launched.page.getByTestId("writing-layer-breakdown").innerText(), {
        timeout: 60_000,
      })
      .toContain("32768");

    const results: Array<Record<string, unknown>> = [];
    for (const [index, pack] of PACKS.entries()) {
      const checkedPacks = launched.page.locator(
        '[data-testid^="writing-layer-knowledge-pack-"]:checked',
      );
      while ((await checkedPacks.count()) > 0) await checkedPacks.first().uncheck();

      const packRow = launched.page
        .getByTestId("writing-layer-knowledge")
        .locator("label", { hasText: pack.name })
        .first();
      await packRow.getByRole("checkbox").check();
      await expect(launched.page.getByText("Always on").first()).toBeVisible({ timeout: 30_000 });
      await expect(launched.page.getByTestId("writing-layer-over-budget")).toHaveCount(0);
      await expect.poll(
        async () => (await launched.page.getByTestId("writing-layer-tokens").innerText()).includes("/ ?"),
        { timeout: 30_000 },
      ).toBe(false);

      const meter = (await launched.page.getByTestId("writing-layer-tokens").innerText()).trim();
      const contractTokens = (await launched.page.getByTestId("writing-layer-contract-tokens").innerText())
        .replace(/\s+/g, " ")
        .trim();

      await launched.page.locator('textarea[aria-label="Intent or source prompt"]').fill(pack.intent);
      await expect(launched.page.getByTestId("orchestrator-run")).toBeEnabled();
      await launched.page.getByTestId("orchestrator-run").click();
      await expect(launched.page.getByTestId("orchestrator-streaming")).toBeVisible({
        timeout: 60_000,
      });
      await expect(launched.page.getByTestId("orchestrator-streaming")).toHaveCount(0, {
        timeout: 900_000,
      });

      const traceTab = launched.page.getByRole("tab", { name: "Term trace", exact: true });
      await expect(traceTab).toBeEnabled({ timeout: 60_000 });
      await traceTab.click();
      const panel = launched.page.getByTestId("orchestrator-result-panel");
      await expect(panel).toContainText(pack.traceTitle);
      await expect(panel).toContainText("Injected as parameters");
      const trace = (await panel.innerText()).replace(/\s+/g, " ").trim();
      await captureAppPage(
        launched.app,
        launched.page,
        path.join(OUTPUT_DIR, index === 0 ? "08-s9-contract-32k.png" : "09-stani-contract-32k.png"),
      );

      await launched.page.getByRole("tab", { name: "Complete prompt", exact: true }).click();
      await expect(launched.page.getByTestId("orchestrator-reuse-intent")).toBeVisible({
        timeout: 30_000,
      });
      const prompt = await readGeneratedPrompt(launched.page);
      expect(prompt.length).toBeGreaterThan(20);
      const warnings = (await launched.page.getByTestId("orchestrator-warnings").count()) > 0
        ? (await launched.page.getByTestId("orchestrator-warnings").innerText()).replace(/\s+/g, " ").trim()
        : "";
      const stats = (await launched.page.getByTestId("orchestrator-run-stats").count()) > 0
        ? (await launched.page.getByTestId("orchestrator-run-stats").innerText()).replace(/\s+/g, " ").trim()
        : "";
      results.push({
        pack: pack.name,
        meter,
        contractTokens,
        prompt,
        warnings,
        stats,
        trace: trace.slice(0, 2500),
      });

      if (index < PACKS.length - 1) {
        await launched.page.reload();
        await openOrchestrator(launched.page);
        await launched.page.getByTestId("orchestrator-model-source-local").click();
      }
    }

    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(OUTPUT_DIR, "live-contract-32k.json"),
      JSON.stringify({ at: new Date().toISOString(), contextSize: 32768, results }, null, 2),
      "utf8",
    );
  } finally {
    if (launched) {
      await launched.page
        .evaluate(() => window.api.localLlama.unload().catch(() => undefined))
        .catch(() => undefined);
      await launched.app.close();
    }
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});