import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
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
  "../../../../outputs/p9-writing-presets-20261124",
);

async function openWritingPresets(page: Page) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Writing Presets", exact: true }).click();
  await expect(page.getByTestId("writing-presets-settings")).toBeVisible();
}

test("edits, deletes and imports writing presets on an isolated profile", async () => {
  test.setTimeout(240_000);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prompthub-writing-presets-"));
  const profile = path.join(root, "profile");
  let app: ElectronApplication | null = null;
  let launched: Awaited<ReturnType<typeof launchPromptHub>> | null = null;
  try {
    launched = await launchPromptHub(null, { userDataDir: profile });
    app = launched.app;
    await setAppSettings(launched.page, { language: "en", autoCheckUpdate: false });
    await openWritingPresets(launched.page);

    const rows = launched.page.locator('[data-testid^="writing-preset-row-"]');
    await expect(rows).toHaveCount(5);
    await expect(launched.page.getByText("Built-in", { exact: true }).first()).toBeVisible();

    // The shipped MOSS preset exposes its compressed text, its sections and a
    // token estimate; the original tab stays empty because seeds have no source copy.
    await launched.page.getByTestId("writing-preset-row-builtin-moss-writing-core").click();
    await expect(launched.page.getByText("Read-only", { exact: true })).toBeVisible();
    const compressed = launched.page.getByTestId("writing-preset-compressed");
    await expect(compressed).toBeVisible();
    await expect(compressed).toHaveValue(/Caption architecture/);
    await expect(launched.page.getByTestId("writing-preset-save")).toBeDisabled();
    await launched.page.getByTestId("writing-preset-tab-sections").click();
    await expect(launched.page.getByRole("row")).toHaveCount(6);
    await launched.page.getByTestId("writing-preset-tab-original").click();
    await expect(launched.page.getByText("This preset has no original document.")).toBeVisible();
    await launched.page.getByTestId("writing-preset-tab-compressed").click();

    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await captureAppPage(app, launched.page, path.join(SCREENSHOT_DIR, "01-builtin-library.png"));

    // Copying a built-in produces an editable user preset with its own row.
    await launched.page.getByTestId("writing-preset-copy").click();
    await expect(launched.page.getByTestId("writing-preset-notice")).toContainText("Copied");
    const editable = launched.page.getByTestId("writing-preset-compressed");
    await expect(editable).toBeEnabled();
    await editable.fill(`${await editable.inputValue()}\n\n## Local note\nPrefer muted palettes.`);
    await launched.page.getByTestId("writing-preset-save").click();
    await expect(launched.page.getByTestId("writing-preset-notice")).toContainText("saved");
    await expect(rows).toHaveCount(6);
    await captureAppPage(app, launched.page, path.join(SCREENSHOT_DIR, "02-edited-copy.png"));

    // A full renderer reload must read the saved row back from SQLite.
    await launched.page.reload();
    await openWritingPresets(launched.page);
    const savedRow = launched.page.locator('[data-testid^="writing-preset-row-"]').filter({
      hasText: "MOSS 写作核心（压缩） (copy)",
    });
    await expect(savedRow).toHaveCount(1);

    // Import a real saved web page. Only the native picker is stubbed; reading,
    // extraction and storage all use the production path.
    const sourceDoc = path.resolve(__dirname, "../../../../prompt/krea2官方生图规范.htm");
    await app.evaluate(({ dialog }, filePath) => {
      Reflect.set(dialog, "showOpenDialog", async () => ({
        canceled: false,
        filePaths: [filePath],
      }));
    }, sourceDoc);
    await launched.page.getByTestId("writing-preset-import").click();
    await expect(launched.page.getByTestId("writing-preset-import-panel")).toBeVisible();
    const panelText = await launched.page.getByTestId("writing-preset-import-panel").innerText();
    expect(panelText).toContain("krea2官方生图规范.htm");
    expect(panelText).toMatch(/[1-9][0-9,]* chars/);

    await launched.page
      .getByTestId("writing-preset-import-compressed")
      .fill("## Output format\nWrite one coherent English prompt. Keep exact on-image text quoted.");
    await launched.page.getByTestId("writing-preset-save-import").click();
    await expect(launched.page.getByTestId("writing-preset-notice")).toContainText("Imported");
    await expect(launched.page.locator('[data-testid^="writing-preset-row-"]')).toHaveCount(7);

    await launched.page.getByTestId("writing-preset-tab-original").click();
    await expect(launched.page.locator("pre").first()).toContainText("Krea 2");
    await expect(launched.page.locator("pre").first()).not.toContainText("<div");
    await launched.page.getByTestId("writing-preset-tab-sections").click();
    await expect(launched.page.getByRole("row")).toHaveCount(2);
    await expect(launched.page.getByRole("row").nth(1)).toContainText("Output format");

    // A long imported page title must stay on one truncated line instead of
    // wrapping one CJK character per row.
    const titleMetrics = await launched.page.getByTestId("writing-preset-title").evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        whiteSpace: style.whiteSpace,
        height: element.getBoundingClientRect().height,
      };
    });
    expect(titleMetrics.whiteSpace).toBe("nowrap");
    expect(titleMetrics.height).toBeLessThan(30);
    await captureAppPage(app, launched.page, path.join(SCREENSHOT_DIR, "03-imported-original.png"));

    // Deleting is a two-step action and only applies to user rows.
    await launched.page.getByTestId("writing-preset-delete").click();
    await expect(launched.page.getByTestId("writing-preset-delete")).toContainText("Confirm");
    await launched.page.getByTestId("writing-preset-delete").click();
    await expect(launched.page.locator('[data-testid^="writing-preset-row-"]')).toHaveCount(6);
    await captureAppPage(app, launched.page, path.join(SCREENSHOT_DIR, "04-after-delete.png"));

    await closePromptHub(app, profile);
    app = null;
  } finally {
    if (app) await closePromptHub(app, profile).catch(() => undefined);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
