import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "@playwright/test";
import type { LocalLlamaEngineConfig } from "@prompthub/shared/types";
import { closePromptHub, launchPromptHub, setAppLanguage } from "./helpers/electron";

const SOURCE_CONFIG = path.join(
  process.env.TEMP ?? "C:\\Windows\\Temp",
  "qwenwork",
  "PromptHub-native-manual-test",
  "profile-ninfer",
  "config",
  "local-llama.json",
);
const SOURCE_DB = path.join(
  process.env.TEMP ?? "C:\\Windows\\Temp",
  "qwenwork",
  "PromptHub-native-manual-test",
  "profile",
  "data",
  "prompthub.db",
);
const OUTPUT_DIR = path.resolve(__dirname, "../../../../outputs/prompt-new-branch1o-20261128");
const LIBRARY_ROOT = path.resolve(
  __dirname,
  "../../../../prompt/new/【014】加载图库节点+服装、发型、姿势、人像等6000套素材/models/GHIL",
);

const SEED = [
  {
    id: "ghil:costume:AUT-0001",
    kind: "costume",
    path: path.join(LIBRARY_ROOT, "costume", "img", "AUT-0001.jpg"),
    title: "黑色长风衣 雨夜",
    meta: { category: "外套", keywords: ["raincoat", "long coat"] },
  },
  {
    id: "ghil:hair:h-f000a1c4200",
    kind: "hair",
    path: path.join(LIBRARY_ROOT, "hair", "img", "h-f000a1c4200.jpg"),
    title: "长发 · 直发",
    meta: { section: "long", sectionZh: "长发", hairZh: "直发" },
  },
  {
    id: "ghil:portrait:f000a1c4200",
    kind: "portrait",
    path: path.join(LIBRARY_ROOT, "portrait", "img", "f000a1c4200.jpg"),
    title: "正脸参考",
    meta: { section: "front", sectionZh: "正脸" },
  },
  {
    id: "ghil:pose:full:sexy:P001:front",
    kind: "pose",
    path: path.join(LIBRARY_ROOT, "pose", "img", "full_sexy_P001_front.jpg"),
    title: "站姿 P001 正面",
    meta: { group: "full", poseNumber: "P001", angle: "front" },
  },
];

function seedAssets(dbPath: string): void {
  const db = new DatabaseSync(dbPath);
  db.exec(
    `CREATE TABLE IF NOT EXISTS source_assets (
       id TEXT PRIMARY KEY, kind TEXT, path TEXT, title TEXT, meta TEXT, created_at INTEGER NOT NULL
     )`,
  );
  const insert = db.prepare(
    "INSERT OR REPLACE INTO source_assets (id, kind, path, title, meta, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  for (const asset of SEED) {
    insert.run(asset.id, asset.kind, asset.path, asset.title, JSON.stringify(asset.meta), Date.now());
  }
  db.close();
}

test("asset gallery browses the four libraries with real thumbnails", async () => {
  test.setTimeout(900_000);
  const source = JSON.parse(fs.readFileSync(SOURCE_CONFIG, "utf8")) as LocalLlamaEngineConfig;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prompthub-asset-gallery-"));
  const profile = path.join(root, "profile");
  const report: Record<string, unknown> = {};
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  for (const asset of SEED) {
    expect(fs.existsSync(asset.path), `seed picture exists: ${asset.path}`).toBe(true);
  }
  let app: Awaited<ReturnType<typeof launchPromptHub>>["app"] | null = null;
  try {
    const initialized = await launchPromptHub(null, { userDataDir: profile });
    await setAppLanguage(initialized.page, "en");
    await initialized.app.close();

    const dataDir = path.join(profile, "data");
    fs.mkdirSync(dataDir, { recursive: true });
    const dbPath = path.join(dataDir, "prompthub.db");
    fs.copyFileSync(SOURCE_DB, dbPath);
    seedAssets(dbPath);

    const launched = await launchPromptHub(null, { userDataDir: profile });
    app = launched.app;
    const page = launched.page;
    await setAppLanguage(page, "en");
    await page.waitForLoadState("domcontentloaded");
    await page.evaluate(async (nextConfig) => {
      await window.api.localLlama.unload().catch(() => undefined);
      await window.api.localLlama.saveConfig(nextConfig);
    }, { ...source, mmprojPath: "" });
    const entry = page.getByRole("button", { name: "Prompt Orchestrator", exact: true });
    if ((await entry.count()) > 0) await entry.click();
    await expect(page.getByTestId("orchestrator-writing-layer")).toBeVisible({ timeout: 60_000 });

    // The gallery sits next to the picker in the term-driven workspace.
    await page.getByRole("button", { name: "Who drives the draft" }).click();
    await page.getByRole("option", { name: /Term-driven/ }).click();
    await expect(page.getByTestId("orchestrator-workspace-tabs")).toBeVisible();
    await page.getByTestId("orchestrator-workspace-tab-gallery").click();

    const gallery = page.getByTestId("orchestrator-asset-gallery");
    await expect(gallery).toBeVisible();
    await expect(page.getByTestId("orchestrator-asset-kind-all")).toContainText("4");
    await expect(page.getByTestId("orchestrator-asset-kind-costume")).toContainText("1");
    await expect(gallery.getByText("黑色长风衣 雨夜")).toBeVisible();
    await expect(page.getByTestId("orchestrator-asset-range")).toContainText("1–4 / 4");

    // Thumbnails come from the main process as data URLs, not from copied files.
    const thumbSource = await page
      .getByTestId("orchestrator-asset-card-ghil:costume:AUT-0001")
      .locator("img")
      .getAttribute("src", { timeout: 60_000 });
    expect(thumbSource?.startsWith("data:image/jpeg;base64,")).toBe(true);
    report.thumbnailPrefix = thumbSource?.slice(0, 32);

    await page.getByTestId("orchestrator-asset-card-ghil:pose:full:sexy:P001:front").click();
    const detail = page.getByTestId("orchestrator-asset-detail");
    await expect(detail).toBeVisible();
    await expect(detail).toContainText("ghil:pose:full:sexy:P001:front");
    await expect(detail).toContainText("full_sexy_P001_front.jpg");
    report.detailText = (await detail.innerText()).slice(0, 200);

    // Filters narrow the grid without leaving the page.
    await page.getByTestId("orchestrator-asset-kind-hair").click();
    await expect(page.getByTestId("orchestrator-asset-range")).toContainText("1–1 / 1");
    await expect(gallery.getByText("长发 · 直发")).toBeVisible();
    report.filtered = true;

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    report.overflow = overflow;
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);

    const shot = await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      const image = await win.webContents.capturePage();
      return image.toPNG().toString("base64");
    });
    fs.writeFileSync(
      path.join(OUTPUT_DIR, "asset-gallery.png"),
      Buffer.from(shot, "base64"),
    );
    report.ok = true;
  } finally {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(OUTPUT_DIR, "asset-gallery.json"),
      JSON.stringify(report, null, 2),
    );
    if (app) await closePromptHub(app, profile, { preserveUserDataDir: false });
  }
});