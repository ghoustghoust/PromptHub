import { expect, test } from "@playwright/test";
import fs from "fs";
import path from "path";

import { captureAppPage, launchPromptHub } from "./helpers/electron";

const SCREENSHOT_DIR = path.resolve(__dirname, "../../../../outputs/p9-batch4-20261124");

test("a real target start failure restores the previous context and engine", async () => {
  test.setTimeout(420_000);
  const profile = path.join(
    process.env.TEMP ?? "C:\\Windows\\Temp",
    "qwenwork",
    "PromptHub-native-manual-test",
    "profile",
  );
  const launched = await launchPromptHub(null, { userDataDir: profile });
  const { app, page } = launched;
  try {
    await page.waitForLoadState("domcontentloaded");
    const before = await page.evaluate(async () => {
      const config = await window.api.localLlama.getConfig();
      const status = await window.api.localLlama.getStatus();
      return { contextSize: config.contextSize, kvCacheType: config.kvCacheType, phase: status.phase };
    });

    if (before.phase !== "running") {
      // Start from a known 8K engine so the rollback has something to restore.
      await page.evaluate(async () => {
        await window.api.localLlama.switchContextPreset("8k", true);
      });
    }
    const runningBefore = await page.evaluate(() => window.api.localLlama.getStatus());
    expect(runningBefore.phase).toBe("running");
    const pidBefore = runningBefore.pid;

    // The failure is injected once in main; unload, config write and the
    // rollback restart are the production path.
    await app.evaluate(() => {
      process.env.PROMPTHUB_E2E_FAIL_NEXT_START = "1";
    });
    const outcome = await page.evaluate(async () => {
      try {
        await window.api.localLlama.switchContextPreset("32k", true);
        return { error: null as string | null };
      } catch (cause) {
        return { error: cause instanceof Error ? cause.message : String(cause) };
      }
    });
    expect(outcome.error).toContain("Rolled back to 8k");

    const after = await page.evaluate(async () => {
      const config = await window.api.localLlama.getConfig();
      const status = await window.api.localLlama.getStatus();
      return {
        contextSize: config.contextSize,
        kvCacheType: config.kvCacheType,
        kvOffload: config.kvOffload,
        phase: status.phase,
        pid: status.pid,
      };
    });
    expect(after).toMatchObject({
      contextSize: 8192,
      kvCacheType: "q8_0",
      kvOffload: true,
      phase: "running",
    });
    expect(after.pid).toBeTruthy();
    expect(after.pid).not.toBe(pidBefore);

    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window?.setSize(1440, 900);
      window?.showInactive();
    });
    await page.waitForTimeout(500);
    await captureAppPage(app, page, path.join(SCREENSHOT_DIR, "02-rollback-restored.png"));
  } finally {
    await page
      .evaluate(() => window.api.localLlama.unload().catch(() => undefined))
      .catch(() => undefined);
    await app.close();
  }
});
