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
    moduleTitle: "铁律与红线",
    intent:
      "Storyboard a 30-second chase: a courier sprints through a rainy neon alley while guards close in.",
  },
  {
    name: "斯坦尼斯拉夫斯基（Kimi 规范版）",
    root: path.join(
      REPO,
      "prompt/new/斯坦尼斯拉夫斯基表演体系skill/斯坦尼斯拉夫斯基表演体系skill/Kimi最终稿",
    ),
    moduleTitle: "剧本篇 · 一、公共坐标（先读这一页）",
    intent:
      "A young actress auditions for a role; write the scene around her objective and inner action.",
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
  return count > 0 ? (await textareas.nth(count - 1).inputValue()).trim() : "";
}

test("runs the local engine once with the s9 pack and once with the Stanislavski pack", async () => {
  test.setTimeout(1_800_000);
  const config = JSON.parse(fs.readFileSync(LOCAL_CONFIG, "utf8")) as LocalLlamaEngineConfig;
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "prompthub-e2e-knowledge-two-"));
  let launched: Awaited<ReturnType<typeof launchPromptHub>> | null = null;
  try {
    launched = await launchPromptHub(null, { userDataDir });
    await setAppLanguage(launched.page, "en");
    await launched.page.evaluate(async (nextConfig) => {
      await window.api.localLlama.unload().catch(() => undefined);
      await window.api.localLlama.saveConfig(nextConfig);
    }, { ...config, mmprojPath: "" });

    await openOrchestrator(launched.page);
    for (const pack of PACKS) {
      const committed = await launched.page.evaluate(async ({ rootPath, name }) => {
        const preview = await window.api.promptKnowledge.previewPack({ rootPath });
        if (preview.ok !== true) return preview.error.message;
        const result = await window.api.promptKnowledge.commitImport({
          preview: preview.data,
          packName: name,
        });
        return result.ok === true ? result.data.moduleCount : result.error.message;
      }, { rootPath: pack.root, name: pack.name });
      if (typeof committed !== "number") {
        throw new Error(`${pack.name}: ${committed}`);
      }
    }

    await launched.page.reload();
    await openOrchestrator(launched.page);
    await launched.page.getByTestId("orchestrator-model-source-local").click();
    const startButton = launched.page.getByTestId("orchestrator-engine-start");
    if ((await startButton.count()) > 0) await startButton.click();
    await expect(launched.page.getByTestId("orchestrator-engine-start")).toHaveCount(0, {
      timeout: 300_000,
    });

    const results: Array<Record<string, unknown>> = [];
    for (const [index, pack] of PACKS.entries()) {
      const checkedPacks = launched.page.locator(
        '[data-testid^="writing-layer-knowledge-pack-"]:checked',
      );
      while ((await checkedPacks.count()) > 0) {
        await checkedPacks.first().uncheck();
      }
      const packRow = launched.page
        .getByTestId("writing-layer-knowledge")
        .locator("label", { hasText: pack.name })
        .first();
      await packRow.getByRole("checkbox").check();
      const moduleRow = launched.page
        .getByTestId("writing-layer-knowledge")
        .locator("label", { hasText: pack.moduleTitle })
        .first();
      await expect(moduleRow).toBeVisible({ timeout: 30_000 });
      await moduleRow.getByRole("checkbox").check();
      const moduleTokens = (await launched.page.getByTestId("writing-layer-knowledge-tokens").innerText())
        .replace(/\s+/g, " ")
        .trim();

      await launched.page.locator('textarea[aria-label="Intent or source prompt"]').fill(pack.intent);
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
      await expect(panel).toContainText(pack.moduleTitle.split(" ")[0]);
      await expect(panel).toContainText("Injected as parameters");
      const trace = (await panel.innerText()).replace(/\s+/g, " ").trim();
      if (index === 0) {
        await captureAppPage(
          launched.app,
          launched.page,
          path.join(OUTPUT_DIR, "05-s9-trace.png"),
        );
      }

      await launched.page.getByRole("tab", { name: "Complete prompt", exact: true }).click();
      await expect(launched.page.getByTestId("orchestrator-reuse-intent")).toBeVisible({
        timeout: 30_000,
      });
      const prompt = await readGeneratedPrompt(launched.page);
      expect(prompt.length).toBeGreaterThan(20);
      results.push({
        pack: pack.name,
        module: pack.moduleTitle,
        moduleTokens,
        intent: pack.intent,
        prompt,
        trace: trace.slice(0, 2000),
      });
      if (index === 1) {
        await captureAppPage(
          launched.app,
          launched.page,
          path.join(OUTPUT_DIR, "06-stanislavski-prompt.png"),
        );
      }

      // Reload the renderer between packs: the result drawer hides the intent
      // box, while the engine keeps running in the main process.
      if (index < PACKS.length - 1) {
        await launched.page.waitForTimeout(1200);
        await launched.page.reload();
        await openOrchestrator(launched.page);
        await launched.page.getByTestId("orchestrator-model-source-local").click();
        const restartButton = launched.page.getByTestId("orchestrator-engine-start");
        if ((await restartButton.count()) > 0) {
          await restartButton.click();
          await expect(restartButton).toHaveCount(0, { timeout: 300_000 });
        }
      }
    }

    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(OUTPUT_DIR, "live-two-packs.json"),
      JSON.stringify({ at: new Date().toISOString(), results }, null, 2),
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