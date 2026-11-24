import path from "node:path";
import { expect, test } from "@playwright/test";

import { launchPromptHub } from "./helpers/electron";

test("stops a real layout caption refinement", async () => {
  test.setTimeout(300_000);
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
    const entry = page.getByRole("button", { name: "Prompt Orchestrator", exact: true });
    if ((await entry.count()) > 0) await entry.click();
    await expect(page.getByTestId("orchestrator-writing-layer")).toBeVisible();

    await page.getByTestId("orchestrator-model-source-local").click();
    const startButton = page.getByTestId("orchestrator-engine-start");
    if ((await startButton.count()) > 0) await startButton.click();
    await expect(page.getByTestId("orchestrator-engine-start")).toHaveCount(0, {
      timeout: 240_000,
    });

    const panel = page.getByTestId("orchestrator-config-panel");
    await panel.locator('button[aria-haspopup="listbox"][aria-label="Output format"]').click();
    await page.getByRole("option", { name: "Exact Layout JSON", exact: true }).click();
    // Several boxes make the refinement long enough to stop mid-flight.
    for (let index = 0; index < 6; index += 1) {
      await page.getByTestId("layout-add-object").click();
    }
    await page.getByTestId("layout-refine-captions").click();

    const stop = page.getByTestId("orchestrator-cancel-layout-assist");
    await expect(stop).toBeVisible({ timeout: 60_000 });
    await stop.click();
    await expect(page.getByTestId("orchestrator-cancel-layout-assist")).toHaveCount(0, {
      timeout: 30_000,
    });
    await expect(page.getByTestId("layout-assist-note")).toContainText("stopped");
  } finally {
    await page
      .evaluate(() => window.api.localLlama.unload().catch(() => undefined))
      .catch(() => undefined);
    await app.close();
  }
});
