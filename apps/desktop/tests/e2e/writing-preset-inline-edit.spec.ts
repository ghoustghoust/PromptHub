import { expect, test } from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";

import { closePromptHub, launchPromptHub, setAppSettings } from "./helpers/electron";

test("searches and edits a user writing preset on the orchestrator page", async () => {
  test.setTimeout(120_000);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prompthub-inline-edit-"));
  const profile = path.join(root, "profile");
  let app: Awaited<ReturnType<typeof launchPromptHub>>["app"] | null = null;
  try {
    const launched = await launchPromptHub(null, { userDataDir: profile });
    app = launched.app;
    const page = launched.page;
    await setAppSettings(page, { language: "en", autoCheckUpdate: false });

    const created = await page.evaluate(async () => {
      const reply = await window.api.promptWritingPresets.save({
        name: "Inline guide",
        targetSkill: "k2",
        methodology: "writing-guide",
        compressedContent: "## Alpha\nAlpha body.",
      });
      return reply.ok === true ? reply.data.id : "";
    });
    expect(created).toBeTruthy();

    await page.reload();
    await page.getByRole("button", { name: "Prompt Orchestrator", exact: true }).click();
    await expect(page.getByTestId("orchestrator-writing-layer")).toBeVisible();
    await page.getByTestId("writing-layer-mode-preset").click();

    const layer = page.getByTestId("orchestrator-writing-layer");
    await layer.getByTestId("writing-layer-search").fill("Inline");
    await layer.getByRole("button", { name: "Writing preset" }).click();
    await expect(page.getByRole("option", { name: "Inline guide" })).toBeVisible();
    await expect(page.getByRole("option", { name: "MOSS 写作核心（压缩）" })).toHaveCount(0);
    await page.getByRole("option", { name: "Inline guide" }).click();

    await expect(layer.getByTestId("writing-layer-edit")).toBeVisible();
    await layer.getByTestId("writing-layer-edit").click();
    await page
      .getByTestId("writing-layer-edit-text")
      .fill("## Alpha\nEdited alpha body.\n\n## Beta\nBeta body.");
    await layer.getByTestId("writing-layer-edit-save").click();
    await expect(layer.getByText("Preset saved.")).toBeVisible();
    await expect(layer.getByTestId("writing-layer-preview")).toContainText("Edited alpha body.");

    // The built-in preset cannot be edited inline.
    await layer.getByTestId("writing-layer-search").fill("");
    await layer.getByRole("button", { name: "Writing preset" }).click();
    await page.getByRole("option", { name: "MOSS 写作核心（压缩）" }).click();
    await expect(layer.getByTestId("writing-layer-edit")).toHaveCount(0);
    await expect(layer.getByText("Built-in presets are read-only")).toBeVisible();

    await closePromptHub(app, profile);
    app = null;
  } finally {
    if (app) await closePromptHub(app, profile).catch(() => undefined);
    fs.rmSync(root, { recursive: true, force: true });
  }
});