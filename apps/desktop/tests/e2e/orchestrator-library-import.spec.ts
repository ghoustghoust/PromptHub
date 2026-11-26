import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";

import { captureAppPage, closePromptHub, launchPromptHub, setAppSettings } from "./helpers/electron";

const SCREENSHOT_DIR = path.resolve(__dirname, "../../../../outputs/prompt-new-batch3-20261126");
/** A one pixel PNG; the fixture only needs a file the main process can read. */
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function writeFile(target: string, content: string | Buffer): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function seedColorCards(root: string): void {
  for (const [id, name] of [["001", "测试导演"], ["002", "第二位导演"]]) {
    const dir = path.join(root, "01_黑色悬疑与冷调惊悚", `${id}_${name}`);
    writeFile(
      path.join(dir, "assets", "color_palettes", "palette.json"),
      JSON.stringify({
        director: { id, name_zh: name, category: "01_黑色悬疑与冷调惊悚" },
        palette: { primary: [{ hex: "#112233" }, { hex: "#445566" }] },
      }),
    );
    writeFile(
      path.join(dir, "assets", "references", "reference_director_manifest.json"),
      JSON.stringify({
        style_profile: { definition: `${name}的低饱和冷调。`, lighting: "侧逆硬光" },
      }),
    );
    writeFile(path.join(dir, "assets", "color_palettes", "palette_main.png"), TINY_PNG);
  }
}

function seedAssets(root: string): void {
  writeFile(path.join(root, "costume", "img", "SPR-0001.jpg"), TINY_PNG);
  writeFile(path.join(root, "costume", "thumbs", "SPR-0001.png"), TINY_PNG);
  writeFile(
    path.join(root, "costume", "data", "costume-zh.json"),
    JSON.stringify([
      {
        id: "SPR-0001",
        分类: "春装",
        关键词: ["象牙白", "针织"],
        英文关键词: "ivory knit",
        缩略图: "thumbs/SPR-0001.png",
        原图: "img/SPR-0001.jpg",
      },
    ]),
  );
  writeFile(path.join(root, "pose", "img", "P001-front.jpg"), TINY_PNG);
  writeFile(path.join(root, "pose", "thumbs", "P001-front.png"), TINY_PNG);
  writeFile(
    path.join(root, "pose", "data", "pose-zh.json"),
    JSON.stringify([
      {
        id: "full_P001_front",
        体系: "全身单人",
        姿势编号: "P001",
        分类: "站姿",
        姿势名称: "S形站姿",
        角度: "正面",
        缩略图: "thumbs/P001-front.png",
        原图: "img/P001-front.jpg",
      },
    ]),
  );
}

async function resize(app: ElectronApplication, width: number, height: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => {
    const window = BrowserWindow.getAllWindows()[0];
    window?.setSize(size.width, size.height);
    window?.showInactive();
  }, { width, height });
}

async function openOrchestrator(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  const entry = page.getByRole("button", { name: "Prompt Orchestrator", exact: true });
  if ((await entry.count()) > 0) await entry.click();
  await expect(page.getByTestId("orchestrator-writing-layer")).toBeVisible();
}

test("imports the color cards and the picture library through the desktop UI", async () => {
  test.setTimeout(240_000);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prompthub-library-e2e-"));
  const colorCardRoot = path.join(root, "cards");
  const assetRoot = path.join(root, "assets");
  seedColorCards(colorCardRoot);
  seedAssets(assetRoot);
  const profile = path.join(root, "profile");
  let app: ElectronApplication | null = null;
  try {
    const launched = await launchPromptHub(null, {
      userDataDir: profile,
      env: {
        PROMPTHUB_E2E_IMPORT_FOLDERS: colorCardRoot,
        PROMPTHUB_E2E_IMPORT_ASSET_FOLDER: assetRoot,
      },
    });
    app = launched.app;
    const page = launched.page;
    await setAppSettings(page, { language: "en", autoCheckUpdate: false });
    await openOrchestrator(page);

    // The color cards: pick the source, read the preview, write the import.
    await page.getByTestId("reference-import-open").click();
    await expect(page.getByTestId("library-import-preview")).toBeVisible();
    await page.getByTestId("library-import-add-source").click();
    await expect(page.getByTestId("library-import-sources")).toContainText("cards");
    await page.getByTestId("library-import-preview").click();
    await expect(page.getByTestId("library-import-item-count")).toContainText("2");
    await page.getByTestId("library-import-commit").click();
    await expect(page.getByTestId("library-import-result")).toBeVisible();
    await page.getByTestId("library-import-preview").isVisible();
    await page.getByTestId("library-import-close").click();

    // The imported cards show their picture.
    const card = page.locator('[data-testid^="reference-card-"]').first();
    await expect(card).toBeVisible();
    const cardImage = card.locator("img");
    await expect(cardImage).toHaveAttribute("src", /^data:image\//);

    // The picture library: import the four libraries, then filter and mark.
    await page.getByTestId("asset-library-import-open").click();
    await page.getByTestId("library-import-add-source").click();
    await expect(page.getByTestId("library-import-sources")).toContainText("assets");
    await page.getByTestId("library-import-preview").click();
    await expect(page.getByTestId("library-import-item-count")).toContainText("2");
    await page.getByTestId("library-import-commit").click();
    await expect(page.getByTestId("library-import-result")).toBeVisible();
    await page.getByTestId("library-import-close").click();

    await page.getByTestId("asset-library-open").click();
    await expect(page.getByTestId("asset-library-grid")).toBeVisible();
    await expect(page.getByTestId("asset-library-total")).toContainText("2");
    const materialImage = page.locator('[data-testid^="asset-library-item-"] img').first();
    await expect(materialImage).toHaveAttribute("src", /^data:image\//);

    await page.getByTestId("asset-library-kind-pose").click();
    await expect(page.getByTestId("asset-library-grid")).toBeVisible();
    await page.getByTestId("asset-library-item-ghil:pose:全身单人:P001:正面").click();
    await expect(page.getByTestId("asset-library-selected")).toContainText("1");

    // The title of a material must not run into the library it belongs to.
    const cardText = await page
      .locator('[data-testid^="asset-library-item-"]')
      .first()
      .evaluate((element) => {
        const title = element.querySelector('[data-testid="asset-library-item-title"]');
        const kind = element.querySelector('[data-testid="asset-library-item-kind"]');
        if (!title || !kind) return null;
        const titleBox = title.getBoundingClientRect();
        const kindBox = kind.getBoundingClientRect();
        return {
          titleText: title.textContent ?? "",
          titleBottom: titleBox.bottom,
          kindTop: kindBox.top,
          overflow: title.scrollWidth > title.clientWidth + 1,
        };
      });
    expect(cardText).not.toBeNull();
    expect(cardText?.titleText).toBe("S形站姿");
    expect(cardText?.titleBottom).toBeLessThanOrEqual(cardText?.kindTop ?? 0);
    expect(cardText?.overflow).toBe(false);

    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await resize(app, 1440, 900);
    await page.waitForTimeout(500);
    await captureAppPage(app, page, path.join(SCREENSHOT_DIR, "01-asset-library-1440.png"));

    await resize(app, 900, 1300);
    await page.waitForTimeout(500);
    await captureAppPage(app, page, path.join(SCREENSHOT_DIR, "02-asset-library-900.png"));

    await closePromptHub(app, profile);
    app = null;
  } finally {
    if (app) await closePromptHub(app, profile).catch(() => undefined);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
