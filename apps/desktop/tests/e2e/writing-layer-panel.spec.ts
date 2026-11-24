import { expect, test, type ElectronApplication } from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";

import {
  captureAppPage,
  closePromptHub,
  launchPromptHub,
  setAppSettings,
} from "./helpers/electron";

const SCREENSHOT_DIR = path.resolve(
  __dirname,
  "../../../../outputs/p9-writing-layer-20261124",
);

async function openOrchestrator(page: Parameters<typeof setAppSettings>[0]) {
  await page.getByRole("button", { name: "Prompt Orchestrator", exact: true }).click();
  await expect(page.getByTestId("orchestrator-writing-layer")).toBeVisible();
}

test("selects writing preset sections, enforces the budget and persists the choice", async () => {
  test.setTimeout(240_000);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prompthub-writing-layer-"));
  const profile = path.join(root, "profile");
  let app: ElectronApplication | null = null;
  try {
    const launched = await launchPromptHub(null, { userDataDir: profile });
    app = launched.app;
    const page = launched.page;
    await setAppSettings(page, { language: "en", autoCheckUpdate: false });
    await openOrchestrator(page);

    const layer = page.getByTestId("orchestrator-writing-layer");
    await expect(layer.getByTestId("writing-layer-custom")).toBeVisible();

    await layer.getByTestId("writing-layer-mode-preset").click();
    await layer.getByRole("button", { name: "Writing preset" }).click();
    await page.getByRole("option", { name: "MOSS 写作核心（压缩）" }).click();

    await expect(layer.getByTestId("writing-layer-sections")).toBeVisible();
    await expect(layer.getByText("5 of 5 sections selected")).toBeVisible();
    await expect(layer.getByTestId("writing-layer-preview")).toContainText("Priorities and fixed facts");
    await expect(layer.getByTestId("writing-layer-breakdown")).toContainText("context 8192");
    await expect(layer.getByTestId("writing-layer-tokens")).toHaveText(/\d+ \/ \d+ tokens/);
    const meterText = await layer.getByTestId("writing-layer-tokens").innerText();
    expect(Number(meterText.split("/")[0]?.trim())).toBeGreaterThan(0);

    // Unchecking a section removes it from the injected preview immediately.
    await layer.getByTestId("writing-layer-section-1-priorities-and-fixed-facts").uncheck();
    await expect(layer.getByTestId("writing-layer-preview")).not.toContainText(
      "Priorities and fixed facts",
    );
    await expect(layer.getByText("4 of 5 sections selected")).toBeVisible();

    await layer.getByRole("button", { name: "Select none" }).click();
    await expect(layer.getByText("No section is selected, so nothing will be injected.")).toBeVisible();
    await expect(layer.getByTestId("writing-layer-preview")).toHaveText(
      "No section is selected, so nothing will be injected.",
    );

    await layer.getByRole("button", { name: "Select all" }).click();
    await expect(layer.getByTestId("writing-layer-preview")).toContainText("Priorities and fixed facts");

    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await captureAppPage(app, page, path.join(SCREENSHOT_DIR, "01-wide-preset-sections.png"));

    // The choice survives a renderer reload through the workspace row. The
    // orchestrator view itself is also restored, so its sidebar shortcut is
    // hidden and the panel has to be awaited directly.
    await page.waitForTimeout(900);
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByTestId("orchestrator-writing-layer")).toBeVisible();
    await page.waitForTimeout(800);
    await expect(page.getByTestId("writing-layer-preview")).toContainText(
      "Priorities and fixed facts",
    );
    await expect(page.getByTestId("writing-layer-sections")).toBeVisible();

    const layerAfterReload = page.getByTestId("orchestrator-writing-layer");

    // Narrow window: the preset rows, section list and preview must stay
    // readable instead of collapsing into a one-character column.
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1024, 800);
    });
    await page.waitForTimeout(500);
    const narrow = await layerAfterReload.evaluate((element) => {
      const sections = element.querySelector('[data-testid="writing-layer-sections"]');
      const preview = element.querySelector('[data-testid="writing-layer-preview"]');
      return {
        overflow: element.scrollWidth > element.clientWidth + 1,
        sectionsWidth: sections ? sections.getBoundingClientRect().width : 0,
        previewWidth: preview ? preview.getBoundingClientRect().width : 0,
      };
    });
    expect(narrow.overflow).toBe(false);
    expect(narrow.sectionsWidth).toBeGreaterThan(240);
    expect(narrow.previewWidth).toBeGreaterThan(240);

    // Custom text uses the same budget: 3,000 words cannot fit in 8K.
    await layerAfterReload.getByTestId("writing-layer-mode-custom").click();
    const longText = Array.from({ length: 3000 }, (_, index) => `word${index % 97}`).join(" ");
    await page.getByTestId("writing-layer-custom").fill(longText);
    await expect(page.getByTestId("writing-layer-over-budget")).toContainText("Over budget");
    await expect(page.getByTestId("orchestrator-run-blockers")).toContainText(
      "The writing layer exceeds the context budget",
    );

    // Declaring 32K is an explicit user action and clears the block.
    await layerAfterReload.getByRole("button", { name: "Context" }).click();
    await page.getByRole("option", { name: "32K" }).click();
    await expect(page.getByTestId("writing-layer-over-budget")).toHaveCount(0);
    await expect(page.getByTestId("writing-layer-breakdown")).toContainText("context 32768");

    await closePromptHub(app, profile);
    app = null;
  } finally {
    if (app) await closePromptHub(app, profile).catch(() => undefined);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
