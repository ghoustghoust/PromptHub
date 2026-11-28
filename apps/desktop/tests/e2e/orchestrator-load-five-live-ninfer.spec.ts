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
const OUTPUT_DIR = path.resolve(__dirname, "../../../../outputs/prompt-new-branch1i-20261127");

const KNOWLEDGE = {
  id: "load-probe-module",
  moduleKey: "load-probe",
  title: "Camera language",
  content:
    "Prefer motivated practical light, one clear subject, and restrained contrast. Keep the background quieter than the subject and avoid decorative clutter. When a shot feels flat, move the key light thirty degrees rather than adding a second source.",
};

const REFERENCE = {
  id: "load-probe-card",
  nameZh: "冷调参考",
  nameEn: "Cold reference",
  category: "冷调",
  summary: "低饱和冷绿色调，柔和的窗光，克制的对比。",
  palette: ["#1A2E2A", "#A89C3E"],
  style: { lighting: "柔和窗光", framing: "对称构图" },
};

const PROMPTS = [
  { label: "baseline", intent: "A reader by a tall window in soft light.", resources: "none" },
  { label: "term-only", intent: "A courier waits under a street lamp in light rain.", resources: "term" },
  { label: "knowledge", intent: "A potter trims a bowl at a quiet wheel.", resources: "knowledge" },
  { label: "reference", intent: "A night watchman crosses an empty courtyard.", resources: "reference" },
  { label: "all", intent: "An archivist lifts a brittle map from a plan chest, dust in the beam, single overhead fixture, no visitors, no labels.", resources: "all" },
];

test("five runs price their own load", async () => {
  test.setTimeout(1_800_000);
  const source = JSON.parse(fs.readFileSync(SOURCE_CONFIG, "utf8")) as LocalLlamaEngineConfig;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prompthub-load-five-"));
  const profile = path.join(root, "profile");
  const report: { runs: Array<Record<string, unknown>>; complete: boolean } = {
    runs: [],
    complete: false,
  };
  let app: Awaited<ReturnType<typeof launchPromptHub>>["app"] | null = null;
  try {
    const initialized = await launchPromptHub(null, { userDataDir: profile });
    app = initialized.app;
    await setAppLanguage(initialized.page, "en");
    await initialized.app.close();
    app = null;

    const dataDir = path.join(profile, "data");
    fs.mkdirSync(dataDir, { recursive: true });
    fs.copyFileSync(SOURCE_DB, path.join(dataDir, "prompthub.db"));
    const db = new DatabaseSync(path.join(dataDir, "prompthub.db"), { readOnly: true });
    const term = db
      .prepare(
        "SELECT id, category, en FROM prompt_terms WHERE category IN ('lighting','camera') AND validation_status != 'deprecated' LIMIT 1",
      )
      .get() as { id: string; category: string; en: string } | undefined;
    db.close();
    expect(term).toBeTruthy();

    const launched = await launchPromptHub(null, { userDataDir: profile });
    app = launched.app;
    const page = launched.page;
    await setAppLanguage(page, "en");
    await page.evaluate(async (nextConfig) => {
      await window.api.localLlama.unload().catch(() => undefined);
      await window.api.localLlama.saveConfig(nextConfig);
    }, { ...source, mmprojPath: "" });
    await page.waitForLoadState("domcontentloaded");
    const entry = page.getByRole("button", { name: "Prompt Orchestrator", exact: true });
    if ((await entry.count()) > 0) await entry.click();
    await expect(page.getByTestId("orchestrator-writing-layer")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("orchestrator-model-source-local").click();
    const start = page.getByTestId("orchestrator-engine-start");
    if ((await start.count()) > 0) await start.click();
    await expect(page.getByTestId("orchestrator-engine-start")).toHaveCount(0, {
      timeout: 300_000,
    });

    for (const [index, sample] of PROMPTS.entries()) {
      const input: Record<string, unknown> = {
        prompt: sample.intent,
        mode: "polish",
        skill: "moss",
        outputFormat: "caption",
        guidanceMode: "agent-led",
        systemPromptLayerContextSize: 32768,
      };
      if (sample.resources === "term" || sample.resources === "all") {
        input.selectedTermIds = [term!.id];
        input.lockedTermIds = [term!.id];
      }
      if (sample.resources === "knowledge" || sample.resources === "all") {
        input.knowledgeModules = [KNOWLEDGE];
      }
      if (sample.resources === "reference" || sample.resources === "all") {
        input.referenceStyles = [REFERENCE];
      }

      const started = Date.now();
      const reply = await page.evaluate(async (payload) => {
        const response = await window.api.promptOrchestrator.run({
          llmModelId: "model_local_llama_cpp",
          input: payload,
        });
        if (response.ok !== true) return { ok: false as const, error: response.error };
        const result = response.data;
        return {
          ok: true as const,
          status: result.status,
          output: result.completePrompt,
          warnings: result.warnings.slice(0, 3),
          load: result.load ?? null,
          summary: result.retrievalSummary ?? null,
          contract: result.taskContract
            ? { kind: result.taskContract.taskKind, tools: result.taskContract.retrieval.modelTools }
            : null,
        };
      }, input);
      const elapsedMs = Date.now() - started;

      if (!reply.ok) throw new Error(`run failed: ${JSON.stringify(reply.error)}`);
      expect(reply.status).toBe("complete");
      expect(reply.load).not.toBeNull();
      const load = reply.load!;
      expect(load.promptTokens).toBeGreaterThan(0);
      expect(load.breakdown.ruleCard).toBeGreaterThan(0);
      expect(load.completionTokens).toBeGreaterThan(0);

      report.runs.push({
        iteration: index + 1,
        label: sample.label,
        resources: sample.resources,
        termId: term!.id,
        intent: sample.intent,
        elapsedMs,
        status: reply.status,
        outputLength: reply.output.length,
        outputHead: reply.output.slice(0, 160),
        warnings: reply.warnings,
        load,
        summary: reply.summary,
        contract: reply.contract,
      });
      console.log(JSON.stringify({
        label: sample.label,
        elapsedMs,
        prompt: load.promptTokens,
        completion: load.completionTokens,
        breakdown: load.breakdown,
        rounds: load.rounds,
        toolCalls: load.toolCalls,
      }));
    }

    report.complete = true;
  } finally {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUTPUT_DIR, "load-five.json"), JSON.stringify(report, null, 2));
    if (app) {
      await app.evaluate(() => window.api.localLlama.unload().catch(() => undefined)).catch(() => undefined);
      await closePromptHub(app, profile, { preserveUserDataDir: false });
    }
  }
});