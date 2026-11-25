import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test, type Page } from "@playwright/test";
import type {
  LocalLlamaEngineConfig,
  PromptOrchestrationResult,
  PromptReferenceStyleInput,
} from "@prompthub/shared/types";

import { launchPromptHub, setAppLanguage } from "./helpers/electron";

const ROOT = "G:\\program\\3.prompt-forge";
const SOURCE_PROFILE = path.join(
  process.env.TEMP ?? "C:\\Windows\\Temp",
  "qwenwork",
  "PromptHub-native-manual-test",
  "profile",
);
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const PROFILE = path.join(process.env.TEMP ?? "C:\\Windows\\Temp", "qwenwork", `ref-32k-diag-${STAMP}`);
const OUTPUT = path.join(ROOT, "outputs", "a6-phase2-20261125", "engine-32k-diagnosis");
const INTENT =
  "A lone courier waits under a streetlamp in the rain at midnight, holding a sealed letter.";

async function openOrchestrator(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  const entry = page.getByRole("button", { name: "Prompt Orchestrator", exact: true });
  if ((await entry.count()) > 0) await entry.click();
  await expect(page.getByTestId("orchestrator-reference-picker")).toBeVisible();
}

async function status(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(async () => window.api.localLlama.getStatus() as unknown as Record<string, unknown>);
}

async function startEngine(page: Page, config: LocalLlamaEngineConfig): Promise<void> {
  await page.evaluate(async (nextConfig) => {
    await window.api.localLlama.unload().catch(() => undefined);
    await window.api.localLlama.saveConfig(nextConfig);
  }, { ...config, mmprojPath: "", contextSize: 32768 });
  await openOrchestrator(page);
  await page.getByTestId("orchestrator-model-source-local").click();
  const start = page.getByTestId("orchestrator-engine-start");
  if ((await start.count()) > 0) await start.click();
  await expect(start).toHaveCount(0, { timeout: 300_000 });
  await expect.poll(async () => (await status(page)).phase, { timeout: 300_000 }).toBe("running");
}

async function runDirect(
  page: Page,
  label: string,
  referenceStyles: PromptReferenceStyleInput[],
): Promise<{ label: string; wallMs: number; reply: unknown; events: unknown[] }> {
  return page.evaluate(
    async ({ prompt, label, referenceStyles }) => {
      const events: unknown[] = [];
      const started = performance.now();
      const reply = await window.api.promptOrchestrator.run(
        {
          input: {
            prompt,
            mode: "expand",
            skill: "moodyMoss",
            guidanceMode: "agent-led",
            ...(referenceStyles.length > 0 ? { referenceStyles } : {}),
          },
          runId: `diag-${label}-${Date.now()}`,
        },
        {
          onEvent: (event) => {
            if (event.type === "stats" || event.type === "phase") events.push(event);
          },
        },
      );
      return { label, wallMs: Math.round(performance.now() - started), reply, events };
    },
    { prompt: INTENT, label, referenceStyles },
  );
}

test("compare 32K runs without and with three color cards", async () => {
  test.setTimeout(1_500_000);
  const config = JSON.parse(
    fs.readFileSync(path.join(SOURCE_PROFILE, "config", "local-llama.json"), "utf8"),
  ) as LocalLlamaEngineConfig;
  fs.mkdirSync(OUTPUT, { recursive: true });
  fs.mkdirSync(PROFILE, { recursive: true });
  const timeline: Array<Record<string, unknown>> = [];
  const results: Array<Record<string, unknown>> = [];
  let launched: Awaited<ReturnType<typeof launchPromptHub>> | null = null;
  try {
    launched = await launchPromptHub(null, { userDataDir: PROFILE });
    await setAppLanguage(launched.page, "en");
    await launched.app.close();
    launched = null;

    const sourceDb = new DatabaseSync(path.join(SOURCE_PROFILE, "data", "prompthub.db"), {
      readOnly: true,
    });
    const rows = sourceDb
      .prepare(
        `SELECT * FROM prompt_reference_items
          WHERE thumbnail_path IS NOT NULL GROUP BY category ORDER BY category LIMIT 3`,
      )
      .all() as Array<Record<string, string>>;
    sourceDb.close();
    const images = path.join(PROFILE, "data", "images");
    fs.mkdirSync(images, { recursive: true });
    const db = new DatabaseSync(path.join(PROFILE, "data", "prompthub.db"));
    db.exec(`CREATE TABLE IF NOT EXISTS prompt_reference_items (
      id TEXT PRIMARY KEY, name_zh TEXT NOT NULL, name_en TEXT, category TEXT NOT NULL,
      nationality TEXT, era TEXT, summary TEXT NOT NULL, palette_json TEXT NOT NULL DEFAULT '[]',
      style_json TEXT NOT NULL DEFAULT '{}', thumbnail_path TEXT, source_path TEXT NOT NULL,
      source_hash TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);`);
    const insert = db.prepare(`INSERT INTO prompt_reference_items
      (id, name_zh, name_en, category, nationality, era, summary, palette_json, style_json,
       thumbnail_path, source_path, source_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const row of rows) {
      fs.copyFileSync(
        path.join(SOURCE_PROFILE, "data", "images", row.thumbnail_path),
        path.join(images, row.thumbnail_path),
      );
      insert.run(
        row.id, row.name_zh, row.name_en, row.category, row.nationality, row.era,
        row.summary, row.palette_json, row.style_json, row.thumbnail_path, row.source_path,
        row.source_hash, row.created_at, row.updated_at,
      );
    }
    db.close();
    const referenceStyles: PromptReferenceStyleInput[] = rows.map((row) => ({
      id: row.id,
      nameZh: row.name_zh,
      ...(row.name_en ? { nameEn: row.name_en } : {}),
      category: row.category,
      summary: row.summary,
      palette: JSON.parse(row.palette_json) as string[],
      style: JSON.parse(row.style_json) as PromptReferenceStyleInput["style"],
    }));

    launched = await launchPromptHub(null, { userDataDir: PROFILE });
    await startEngine(launched.page, config);
    timeline.push({ step: "engine-started", status: await status(launched.page) });

    const baseline = await runDirect(launched.page, "baseline", []);
    timeline.push({ step: "baseline-finished", status: await status(launched.page) });
    const baselineReply = baseline.reply as { ok: boolean; data?: PromptOrchestrationResult; error?: unknown };
    results.push({ ...baseline, reply: summarize(baselineReply) });
    expect(baselineReply.ok, JSON.stringify(baselineReply.error)).toBe(true);
    await launched.page.waitForTimeout(15_000);
    timeline.push({ step: "after-baseline-wait", status: await status(launched.page) });

    const cardsReply = await runDirect(launched.page, "cards", referenceStyles);
    timeline.push({ step: "cards-finished", status: await status(launched.page) });
    const cardsParsed = cardsReply.reply as { ok: boolean; data?: PromptOrchestrationResult; error?: unknown };
    results.push({ ...cardsReply, reply: summarize(cardsParsed) });
    expect(cardsParsed.ok, JSON.stringify(cardsParsed.error)).toBe(true);

    const baselineResult = baselineReply.data as PromptOrchestrationResult;
    const cardsResult = cardsParsed.data as PromptOrchestrationResult;
    expect(cardsResult.provenance.some((entry) => entry.kind === "reference")).toBe(true);
    fs.writeFileSync(
      path.join(OUTPUT, "live-reference-32k.json"),
      JSON.stringify(
        {
          at: new Date().toISOString(),
          profile: PROFILE,
          intent: INTENT,
          references: referenceStyles.map(({ id, nameZh, category }) => ({ id, nameZh, category })),
          baseline: {
            completePrompt: baselineResult.completePrompt,
            provenance: baselineResult.provenance,
            tokenMetrics: baselineResult.tokenMetrics,
            layerMetrics: baselineResult.systemPromptLayerMetrics,
            events: baseline.events,
            wallMs: baseline.wallMs,
          },
          cards: {
            completePrompt: cardsResult.completePrompt,
            provenance: cardsResult.provenance,
            tokenMetrics: cardsResult.tokenMetrics,
            layerMetrics: cardsResult.systemPromptLayerMetrics,
            events: cardsReply.events,
            wallMs: cardsReply.wallMs,
          },
          timeline,
        },
        null,
        2,
      ),
      "utf8",
    );
    fs.writeFileSync(
      path.join(OUTPUT, "engine-32k-diagnosis.json"),
      JSON.stringify({ at: new Date().toISOString(), profile: PROFILE, timeline, results }, null, 2),
      "utf8",
    );
  } finally {
    const logSource = path.join(PROFILE, "logs", "local-llama-engine.log");
    if (fs.existsSync(logSource)) {
      fs.copyFileSync(logSource, path.join(OUTPUT, "local-llama-engine.log"));
    }
    fs.copyFileSync(
      path.join(PROFILE, "config", "local-llama.json"),
      path.join(OUTPUT, "local-llama.json"),
    );
    if (!fs.existsSync(path.join(OUTPUT, "engine-32k-diagnosis.json"))) {
      fs.writeFileSync(
        path.join(OUTPUT, "engine-32k-diagnosis.json"),
        JSON.stringify({ at: new Date().toISOString(), profile: PROFILE, timeline, results }, null, 2),
        "utf8",
      );
    }
    if (launched) {
      await launched.page
        .evaluate(() => window.api.localLlama.unload().catch(() => undefined))
        .catch(() => undefined);
      await launched.app.close();
    }
  }
});

function summarize(reply: { ok: boolean; data?: PromptOrchestrationResult; error?: unknown }) {
  if (!reply.ok || !reply.data) return reply;
  return {
    ok: true,
    completePrompt: reply.data.completePrompt,
    provenance: reply.data.provenance,
    tokenMetrics: reply.data.tokenMetrics,
    layerMetrics: reply.data.systemPromptLayerMetrics,
  };
}