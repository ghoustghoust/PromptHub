import { expect, test, type ElectronApplication } from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";

import { captureAppPage, closePromptHub, launchPromptHub, setAppSettings } from "./helpers/electron";

const SCREENSHOT_DIR = path.resolve(__dirname, "../../../../outputs/p9-batch4-20261124");

async function resize(app: Awaited<ReturnType<typeof launchPromptHub>>["app"], width: number, height: number) {
  await app.evaluate(({ BrowserWindow }, size) => {
    const window = BrowserWindow.getAllWindows()[0];
    window?.setSize(size.width, size.height);
    window?.showInactive();
  }, { width, height });
}

test("orchestrator writing layer and context controls at 1200 and 900 px", async () => {
  test.setTimeout(120_000);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prompthub-narrow-"));
  const profile = path.join(root, "profile");
  let app: ElectronApplication | null = null;
  try {
    const launched = await launchPromptHub(null, { userDataDir: profile });
    app = launched.app;
    const page = launched.page;
    await setAppSettings(page, { language: "en", autoCheckUpdate: false });
    await page.getByRole("button", { name: "Prompt Orchestrator", exact: true }).click();
    await expect(page.getByTestId("orchestrator-writing-layer")).toBeVisible();
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

    // Pick a preset so the section list and meter are populated.
    await page.getByTestId("writing-layer-mode-preset").click();
    await page.getByRole("button", { name: "Writing preset" }).click();
    await page.getByRole("option", { name: "MOSS 写作核心（压缩）" }).click();
    await expect(page.getByTestId("writing-layer-sections")).toBeVisible();

    const scrollTo = async (testId: string) => {
      await page.getByTestId(testId).evaluate((element) => {
        const panel = element.closest('[data-testid="orchestrator-config-panel"]');
        if (panel) {
          panel.scrollTop =
            element.getBoundingClientRect().top - panel.getBoundingClientRect().top + panel.scrollTop - 16;
        }
      });
    };

    await resize(app, 1200, 900);
    await scrollTo("orchestrator-writing-layer");
    await page.waitForTimeout(500);
    await captureAppPage(app, page, path.join(SCREENSHOT_DIR, "03-writing-layer-1200.png"));

    await resize(app, 900, 1300);
    await scrollTo("orchestrator-writing-layer");
    await page.waitForTimeout(500);
    const narrow = await page.getByTestId("orchestrator-writing-layer").evaluate((element) => ({
      overflow: element.scrollWidth > element.clientWidth + 1,
      sections: element.querySelector('[data-testid="writing-layer-sections"]')?.getBoundingClientRect().width ?? 0,
      preview: element.querySelector('[data-testid="writing-layer-preview"]')?.getBoundingClientRect().width ?? 0,
    }));
    expect(narrow.overflow).toBe(false);
    expect(narrow.sections).toBeGreaterThan(200);
    expect(narrow.preview).toBeGreaterThan(200);
    await scrollTo("writing-layer-sections");
    await page.waitForTimeout(400);
    await captureAppPage(app, page, path.join(SCREENSHOT_DIR, "04-writing-layer-900.png"));

    // Context control lives in the local engine section; keep it narrow too.
    await page.getByTestId("orchestrator-model-source-local").click();
    await page.getByTestId("orchestrator-engine-params-toggle").click();
    await expect(page.getByTestId("orchestrator-engine-params-toggle")).toContainText("8192 ctx");
    await scrollTo("orchestrator-local-engine");
    await page.waitForTimeout(500);
    await captureAppPage(app, page, path.join(SCREENSHOT_DIR, "05-context-900.png"));

    await closePromptHub(app, profile);
    app = null;
  } finally {
    if (app) await closePromptHub(app, profile).catch(() => undefined);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
