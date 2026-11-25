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
const PACK_ROOT = path.resolve(__dirname, "../../../../prompt/new/Skill-Film-v2.00.1");
const OUTPUT_DIR = path.resolve(__dirname, "../../../../outputs/a6-phase2-20261125");

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
  return (await textareas.nth(count - 1).inputValue()).trim();
}

test("runs the local engine with an injected knowledge module and records provenance", async () => {
  test.setTimeout(1_800_000);
  const config = JSON.parse(fs.readFileSync(LOCAL_CONFIG, "utf8")) as LocalLlamaEngineConfig;
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "prompthub-e2e-knowledge-live-"));
  let launched: Awaited<ReturnType<typeof launchPromptHub>> | null = null;
  try {
    launched = await launchPromptHub(null, { userDataDir });
    await setAppLanguage(launched.page, "en");
    await launched.page.evaluate(async (nextConfig) => {
      await window.api.localLlama.unload().catch(() => undefined);
      await window.api.localLlama.saveConfig(nextConfig);
    }, { ...config, mmprojPath: "" });

    await openOrchestrator(launched.page);
    const committed = await launched.page.evaluate(async (rootPath) => {
      const preview = await window.api.promptKnowledge.previewPack({ rootPath });
      if (preview.ok !== true) return preview.error.message;
      const result = await window.api.promptKnowledge.commitImport({ preview: preview.data });
      return result.ok === true ? result.data.moduleCount : result.error.message;
    }, PACK_ROOT);
    expect(committed).toBe(160);

    await launched.page.reload();
    await openOrchestrator(launched.page);
    const pack = launched.page.locator('[data-testid^="writing-layer-knowledge-pack-"]').first();
    await expect(pack).toBeVisible({ timeout: 30_000 });
    await pack.check();
    const module = launched.page.locator('[data-testid^="writing-layer-knowledge-module-"]').first();
    await expect(module).toBeVisible({ timeout: 30_000 });
    await module.check();
    const moduleTokens = (await launched.page.getByTestId("writing-layer-knowledge-tokens").innerText())
      .replace(/\s+/g, " ")
      .trim();

    await launched.page.getByTestId("orchestrator-model-source-local").click();
    const startButton = launched.page.getByTestId("orchestrator-engine-start");
    if ((await startButton.count()) > 0) await startButton.click();
    await expect(launched.page.getByTestId("orchestrator-engine-start")).toHaveCount(0, {
      timeout: 300_000,
    });

    const prompts = [
      "A quiet street at dusk with a lantern, a cat and wet cobblestones.",
      "Two swordsmen duel on a rain-soaked rooftop at night.",
      "An old fisherman mends nets at sunrise.",
      "A bustling night market with steam, neon and crowded stalls.",
      "A lone astronaut walks across a red desert under two moons.",
    ];
    const runs: Array<{ intent: string; prompt: string; trace: string }> = [];
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    for (const [index, intent] of prompts.entries()) {
      await launched.page.locator('textarea[aria-label="Intent or source prompt"]').fill(intent);
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
      await expect(panel).toContainText("module");
      await expect(panel).toContainText("Injected as parameters");
      const traceText = (await panel.innerText()).replace(/\s+/g, " ").trim();
      if (index === 0) {
        await captureAppPage(
          launched.app,
          launched.page,
          path.join(OUTPUT_DIR, "03-live-knowledge-trace.png"),
        );
      }

      await launched.page.getByRole("tab", { name: "Complete prompt", exact: true }).click();
      await expect(launched.page.getByTestId("orchestrator-reuse-intent")).toBeVisible({
        timeout: 30_000,
      });
      const prompt = await readGeneratedPrompt(launched.page);
      expect(prompt.length).toBeGreaterThan(20);
      runs.push({ intent, prompt, trace: traceText.slice(0, 2000) });
      if (index === 0) {
        await captureAppPage(
          launched.app,
          launched.page,
          path.join(OUTPUT_DIR, "04-live-knowledge-prompt.png"),
        );
      }
    }

    fs.writeFileSync(
      path.join(OUTPUT_DIR, "live-knowledge-run.json"),
      JSON.stringify({
        at: new Date().toISOString(),
        moduleTokens,
        moduleCount: 160,
        runs,
      }, null, 2),
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