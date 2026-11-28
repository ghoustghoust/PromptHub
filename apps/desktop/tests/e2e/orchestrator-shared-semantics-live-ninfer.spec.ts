import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type {
  LocalLlamaEngineConfig,
  PromptOrchestrationInput,
  PromptOrchestrationMode,
  PromptOrchestrationOutputFormat,
  PromptOrchestrationSkill,
} from "@prompthub/shared/types";
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
const OUTPUT_DIR = path.resolve(__dirname, "../../../../outputs/prompt-new-branch1j-20261127");

const SHARED = {
  subject: "a courier holding a sealed envelope",
  action: "shaking rain from the envelope",
  setting: "a narrow street after midnight",
  composition: "medium shot from eye level",
  lighting: "one warm practical on wet asphalt",
  continuity: "same coat and envelope as the previous shot",
};

const SAMPLES: Array<{
  label: string;
  skill: PromptOrchestrationSkill;
  mode: PromptOrchestrationMode;
  outputFormat: PromptOrchestrationOutputFormat;
  intent: string;
  allowAdult?: boolean;
}> = [
  {
    label: "moss",
    skill: "moss",
    mode: "expand",
    outputFormat: "caption",
    intent: "A courier waits under a street lamp in the rain.",
  },
  {
    label: "moodyMoss",
    skill: "moodyMoss",
    mode: "expand",
    outputFormat: "caption",
    intent: "A courier checks an envelope under a lamp.",
  },
  {
    label: "k2",
    skill: "k2",
    mode: "expand",
    outputFormat: "caption",
    intent: "A courier in the rain at night, one street lamp.",
  },
  {
    label: "k2-adult",
    skill: "k2",
    mode: "expand",
    outputFormat: "caption",
    intent: "An adult courier waits under a street lamp in the rain.",
    allowAdult: true,
  },
  {
    label: "h3",
    skill: "minimaxH3",
    mode: "video-text",
    outputFormat: "h3",
    intent: "A courier crosses a wet street at midnight, 8 seconds.",
  },
];

test("five prompts compile shared facts once across four skills", async () => {
  test.setTimeout(1_800_000);
  const source = JSON.parse(fs.readFileSync(SOURCE_CONFIG, "utf8")) as LocalLlamaEngineConfig;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prompthub-shared-five-"));
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

    for (const [index, sample] of SAMPLES.entries()) {
      const started = Date.now();
      const input: PromptOrchestrationInput = {
        prompt: sample.intent,
        mode: sample.mode,
        skill: sample.skill,
        outputFormat: sample.outputFormat,
        guidanceMode: "agent-led",
        systemPromptLayerContextSize: 32768,
        sharedSemantics: SHARED,
        ...(sample.mode === "video-text"
          ? { video: { durationSeconds: 8, shotCount: 1 } }
          : {}),
        ...(sample.allowAdult ? { allowAdult: true } : {}),
      };
      const reply = await page.evaluate(async (payload) => {
        const response = await window.api.promptOrchestrator.run({
          llmModelId: "model_local_llama_cpp",
          input: payload,
        });
        if (response.ok !== true) return { ok: false as const, error: response.error };
        return {
          ok: true as const,
          status: response.data.status,
          output: response.data.completePrompt,
          warnings: response.data.warnings.slice(0, 3),
          load: response.data.load ?? null,
          media: response.data.media,
        };
      }, input);
      const elapsedMs = Date.now() - started;
      if (!reply.ok) throw new Error(JSON.stringify(reply.error));

      expect(reply.status).toBe("complete");
      expect(reply.output.length).toBeGreaterThan(40);
      const lowered = reply.output.toLowerCase();
      const facts = ["courier", "envelope", "street", "lamp", "rain"];
      const hits = facts.filter((fact) => lowered.includes(fact));
      expect(hits.length).toBeGreaterThanOrEqual(1);
      if (sample.outputFormat === "h3") {
        expect(reply.output).toContain("integrated_multimodal_description");
      }

      report.runs.push({
        iteration: index + 1,
        label: sample.label,
        skill: sample.skill,
        outputFormat: sample.outputFormat,
        elapsedMs,
        status: reply.status,
        output: reply.output,
        outputLength: reply.output.length,
        facts: hits,
        warnings: reply.warnings,
        load: reply.load,
        media: reply.media,
      });
      console.log(JSON.stringify({
        label: sample.label,
        elapsedMs,
        length: reply.output.length,
        facts: hits,
        status: reply.status,
      }));
    }

    report.complete = true;
  } finally {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUTPUT_DIR, "shared-semantics-five.json"), JSON.stringify(report, null, 2));
    if (app) {
      await app.evaluate(() => window.api.localLlama.unload().catch(() => undefined)).catch(() => undefined);
      await closePromptHub(app, profile, { preserveUserDataDir: false });
    }
  }
});