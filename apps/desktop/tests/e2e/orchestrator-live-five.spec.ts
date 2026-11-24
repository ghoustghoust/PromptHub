import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import fs from "fs";
import path from "path";

import { captureAppPage, launchPromptHub, setAppSettings } from "./helpers/electron";

const SCREENSHOT_DIR = path.resolve(__dirname, "../../../../outputs/p9-batch4-20261124");
const IMAGE_PATH = path.resolve(__dirname, "../../../../prompt/fc388e80facf224fb9cdaeb01fe90870.png");
const REPO_ROOT = path.resolve(__dirname, "../../../..");
const MMPROJ_PATH = (() => {
  const name = fs
    .readdirSync(REPO_ROOT)
    .find((entry) => entry.includes(".mmproj") && entry.endsWith(".gguf"));
  return name ? path.join(REPO_ROOT, name) : "";
})();

async function chooseMode(page: Page, label: string): Promise<void> {
  await page
    .getByTestId("orchestrator-config-panel")
    .locator('button[aria-haspopup="listbox"][aria-label="Mode"]')
    .click();
  await page.getByRole("option", { name: label, exact: true }).click();
}

async function setIntent(page: Page, value: string): Promise<void> {
  const box = page.locator('textarea[aria-label="Intent or source prompt"]');
  await box.fill(value);
}

async function waitForResult(page: Page): Promise<void> {
  // The panel may auto-switch to the decisions tab, so wait on the tab that
  // only becomes enabled when a result exists, then open the complete tab.
  const decisionsTab = page.getByRole("tab", { name: "Strategy comparison", exact: true });
  await expect(decisionsTab).toBeEnabled({ timeout: 600_000 });
  await page.getByRole("tab", { name: "Complete prompt", exact: true }).click();
  await expect(page.getByTestId("orchestrator-reuse-intent")).toBeVisible({ timeout: 30_000 });
}

async function readGeneratedPrompt(page: Page): Promise<string> {
  const comparison = page.getByTestId("orchestrator-comparison");
  if ((await comparison.count()) > 0) {
    // Sentence-aligned results render as rows; the generated side is the button column.
    const parts = await comparison.locator("button").allInnerTexts();
    return parts.join(" ").replace(/\s+/g, " ").trim();
  }
  const textareas = page.getByTestId("orchestrator-result-panel").locator("textarea[readonly]");
  const count = await textareas.count();
  expect(count).toBeGreaterThanOrEqual(2);
  return (await textareas.nth(count - 1).inputValue()).trim();
}

async function readWarnings(page: Page): Promise<string> {
  const warnings = page.getByTestId("orchestrator-warnings");
  return (await warnings.count()) > 0
    ? (await warnings.innerText()).replace(/\s+/g, " ").trim()
    : "";
}

async function readChips(page: Page): Promise<{ tokens: string | null; stats: string | null; layer: string | null }> {
  const panel = page.getByTestId("orchestrator-result-panel");
  const tokens = (await panel.innerText()).match(/Complete tokens:\s*(\d+)/)?.[1] ?? null;
  const stats = (await page.getByTestId("orchestrator-run-stats").count())
    ? (await page.getByTestId("orchestrator-run-stats").innerText()).replace(/\s+/g, " ").trim()
    : null;
  const layer = (await page.getByTestId("orchestrator-layer-metrics").count())
    ? (await page.getByTestId("orchestrator-layer-metrics").innerText()).replace(/\s+/g, " ").trim()
    : null;
  return { tokens, stats, layer };
}

test("five real orchestration runs, polish reuse, reverse and cancel", async () => {
  test.setTimeout(1_800_000);
  const profile = path.join(
    process.env.TEMP ?? "C:\\Windows\\Temp",
    "qwenwork",
    "PromptHub-native-manual-test",
    "profile",
  );
  const launched = await launchPromptHub(null, { userDataDir: profile });
  const { app, page } = launched;
  const artifact: Array<Record<string, unknown>> = [];
  try {
    await setAppSettings(page, { language: "en", autoCheckUpdate: false });
    const entry = page.getByRole("button", { name: "Prompt Orchestrator", exact: true });
    if ((await entry.count()) > 0) await entry.click();
    await expect(page.getByTestId("orchestrator-writing-layer")).toBeVisible();

    // Text runs do not need the vision projector; dropping it keeps 8K fast on
    // an 8 GB card. It is restored before the reverse run and again at the end.
    await page.evaluate(async () => {
      await window.api.localLlama.unload().catch(() => undefined);
      const config = await window.api.localLlama.getConfig();
      await window.api.localLlama.saveConfig({ ...config, mmprojPath: "" });
    });

    // Local engine for every run below.
    await page.getByTestId("orchestrator-model-source-local").click();
    await page.getByTestId("orchestrator-engine-start").click();
    await expect(page.getByTestId("orchestrator-engine-start")).toHaveCount(0, { timeout: 240_000 });

    // 0) Cancel a long generation and confirm the UI settles without a result.
    await setIntent(
      page,
      "Write an extremely long, exhaustive description of a vast medieval battlefield at dawn, with hundreds of soldiers, banners, horses, smoke, mud and scattered weapons.",
    );
    await page.getByTestId("orchestrator-run").click();
    // Cancel works in both tool rounds (buffered) and the final stream; waiting
    // for the streaming stage is not required to prove the abort path.
    await expect(page.getByTestId("orchestrator-streaming")).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(2000);
    await page.getByTestId("orchestrator-cancel").click();
    await expect(page.getByTestId("orchestrator-stopped-note")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("orchestrator-copy-partial")).toBeVisible();
    await expect(page.getByTestId("orchestrator-streaming").getByTestId("orchestrator-cancel")).toHaveCount(0);
    await expect(page.getByRole("alert")).toContainText("Generation stopped");
    await expect(page.getByTestId("orchestrator-reuse-intent")).toHaveCount(0);

    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window?.setSize(1440, 950);
      window?.showInactive();
    });

    const prompts = [
      { mode: "Expand", prompt: "a quiet portrait of an elderly fisherman mending nets at dawn", reuse: false },
      { mode: "Polish", prompt: null, reuse: true },
      { mode: "Expand", prompt: "a neon-lit cyberpunk market in the rain, crowded with umbrellas", reuse: false },
      { mode: "Expand", prompt: "a cat asleep on a sunlit windowsill with dust motes in the air", reuse: false },
      { mode: "Expand", prompt: "an ancient library with floating books and candlelight", reuse: false },
    ];

    for (let index = 0; index < prompts.length; index += 1) {
      const step = prompts[index];
      if (step.reuse) {
        // Iteration 2 polishes the generated prompt from iteration 1; reuse it
        // before switching mode, because a mode change clears the result panel.
        await page.getByTestId("orchestrator-reuse-intent").click();
        await expect(page.getByTestId("orchestrator-intent-origin")).toBeVisible();
        await chooseMode(page, step.mode);
      } else {
        await chooseMode(page, step.mode);
        await setIntent(page, step.prompt ?? "");
      }
      let attempts = 0;
      let generated = "";
      let chips: Awaited<ReturnType<typeof readChips>> = { tokens: null, stats: null, layer: null };
      let warnings = "";
      // A deterministic fallback is not a valid quality sample; retry once and
      // record how many attempts it took.
      while (attempts < 2) {
        attempts += 1;
        await page.getByTestId("orchestrator-run").click();
        await waitForResult(page);
        generated = await readGeneratedPrompt(page);
        warnings = await readWarnings(page);
        chips = await readChips(page);
        if (!warnings.toLowerCase().includes("fallback")) break;
      }
      artifact.push({
        iteration: index + 1,
        mode: step.mode,
        input: step.reuse ? "(previous result)" : step.prompt,
        completePrompt: generated,
        warnings,
        attempts,
        ...chips,
      });
      expect(generated.length).toBeGreaterThan(40);
      expect(warnings.toLowerCase()).not.toContain("fallback");
      await captureAppPage(
        app,
        page,
        path.join(SCREENSHOT_DIR, `run-${index + 1}-${step.mode.toLowerCase()}.png`),
      );
    }

    // Reverse from a local image through the file input; vision needs mmproj.
    // 32K + mmproj is the combination verified in P8; 8K leaves too little room
    // for image tokens plus the output reserve.
    if (MMPROJ_PATH) {
      await page.evaluate(async (mmprojPath) => {
        // Config changes are refused while the managed engine runs.
        await window.api.localLlama.unload().catch(() => undefined);
        const config = await window.api.localLlama.getConfig();
        await window.api.localLlama.saveConfig({ ...config, mmprojPath });
        await window.api.localLlama.switchContextPreset("32k", true);
      }, MMPROJ_PATH);
      await expect
        .poll(
          async () =>
            page.evaluate(async () => {
              const status = await window.api.localLlama.getStatus();
              const config = await window.api.localLlama.getConfig();
              return { phase: status.phase, vision: status.vision, contextSize: config.contextSize };
            }),
          { timeout: 300_000 },
        )
        .toMatchObject({ phase: "running", vision: true, contextSize: 32768 });
    }
    await chooseMode(page, "Reverse");
    await setIntent(page, "Describe this image in one concise English sentence.");
    await page.getByTestId("orchestrator-image-file-input").setInputFiles(IMAGE_PATH);
    await expect(page.getByTestId("orchestrator-clear-images")).toBeVisible();
    await page.getByTestId("orchestrator-run").click();
    await waitForResult(page);
    const reversed = await readGeneratedPrompt(page);
    artifact.push({ iteration: 6, mode: "Reverse", input: path.basename(IMAGE_PATH), completePrompt: reversed, ...(await readChips(page)) });
    expect(reversed.length).toBeGreaterThan(40);
    await captureAppPage(app, page, path.join(SCREENSHOT_DIR, "run-6-reverse.png"));
  } finally {
    // Keep the profile ready for vision on the next manual run.
    if (MMPROJ_PATH) {
      await page
        .evaluate(async (mmprojPath) => {
          await window.api.localLlama.unload().catch(() => undefined);
          const config = await window.api.localLlama.getConfig();
          await window.api.localLlama.saveConfig({
            ...config,
            mmprojPath,
            contextSize: 8192,
          });
        }, MMPROJ_PATH)
        .catch(() => undefined);
    }
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(SCREENSHOT_DIR, "live-runs.json"),
      JSON.stringify(artifact, null, 2),
      "utf8",
    );
    await page
      .evaluate(() => window.api.localLlama.unload().catch(() => undefined))
      .catch(() => undefined);
    await app.close();
  }
});
