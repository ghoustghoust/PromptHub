import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type {
  LocalLlamaEngineConfig,
  PromptOrchestrationInput,
  PromptSharedSemantics,
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

const SAMPLES: Array<{
  label: string;
  input: Omit<PromptOrchestrationInput, "llmModelId">;
  facts: PromptSharedSemantics;
  expect: string[];
}> = [
  {
    label: "moss-market",
    facts: {
      subject: "a florist in a patched apron",
      action: "wiping rain off a bucket of lilies",
      setting: "an open-air market at dawn",
      lighting: "cold blue ambient plus one tungsten bulb",
      continuity: "same apron and flower bucket across shots",
      constraints: ["no logos", "keep hands visible"],
    },
    input: {
      prompt: "A florist opens her stall before sunrise while rain drips off the awning.",
      mode: "expand",
      skill: "moss",
      outputFormat: "caption",
      guidanceMode: "agent-led",
      systemPromptLayerContextSize: 32768,
    },
    expect: ["florist", "lilies", "market"],
  },
  {
    label: "moody-stairwell",
    facts: {
      subject: "a night-shift nurse in a damp coat",
      action: "pausing halfway up a concrete stairwell",
      setting: "hospital stairwell, 3 a.m.",
      composition: "vertical, subject small at the turn of the stairs",
      lighting: "one flickering fluorescent tube, hard shadows",
      palette: "sickly green and dirty white",
    },
    input: {
      prompt: "Silence in a hospital stairwell, someone stops to listen.",
      mode: "expand",
      skill: "moodyMoss",
      outputFormat: "caption",
      guidanceMode: "agent-led",
      systemPromptLayerContextSize: 32768,
    },
    expect: ["nurse", "stairwell", "fluorescent"],
  },
  {
    label: "k2-zh-mixed",
    facts: {
      subject: "一个推着旧自行车的中年男人",
      action: "在积水里停下来点烟",
      setting: "老城区巷口，雨后凌晨",
      lighting: "路灯一盏，湿地面反光",
      continuity: "同一件灰色夹克、同一辆自行车",
    },
    input: {
      prompt: "雨后的老巷，一个人停下来点烟，远处有狗叫。",
      mode: "expand",
      skill: "k2",
      outputFormat: "caption",
      guidanceMode: "agent-led",
      systemPromptLayerContextSize: 32768,
    },
    expect: ["自行车", "烟", "巷"],
  },
  {
    label: "k2-adult",
    facts: {
      subject: "an adult dancer in a dark practice room",
      action: "stretching before rehearsal",
      setting: "empty studio with mirrors",
      lighting: "single softbox, low key",
      continuity: "same leotard and mirror wall",
    },
    input: {
      prompt: "An adult dancer warms up alone in a dark studio, mirrors catching one light.",
      mode: "expand",
      skill: "k2",
      outputFormat: "caption",
      guidanceMode: "agent-led",
      allowAdult: true,
      systemPromptLayerContextSize: 32768,
    },
    expect: ["dancer", "studio", "mirror"],
  },
  {
    label: "h3-crossing",
    facts: {
      subject: "a schoolgirl with a yellow umbrella",
      action: "crossing a flooded zebra crossing",
      setting: "city intersection in heavy rain",
      composition: "wide shot, low angle, subject centre",
      lighting: "overcast daylight",
      continuity: "same umbrella and red boots",
    },
    input: {
      prompt: "A schoolgirl crosses a flooded street in heavy rain, 8 seconds.",
      mode: "video-text",
      skill: "minimaxH3",
      outputFormat: "h3",
      guidanceMode: "agent-led",
      video: { durationSeconds: 8, shotCount: 1 },
      systemPromptLayerContextSize: 32768,
    },
    expect: ["umbrella", "rain", "crossing"],
  },
];

test("five new prompts carry shared facts through the UI entry and API", async () => {
  test.setTimeout(1_800_000);
  const source = JSON.parse(fs.readFileSync(SOURCE_CONFIG, "utf8")) as LocalLlamaEngineConfig;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prompthub-shared-api-five-"));
  const profile = path.join(root, "profile");
  const report: { runs: Array<Record<string, unknown>>; complete: boolean } = {
    runs: [],
    complete: false,
  };
  let app: Awaited<ReturnType<typeof launchPromptHub>>["app"] | null = null;
  try {
    const initialized = await launchPromptHub(null, { userDataDir: profile });
    await setAppLanguage(initialized.page, "en");
    await initialized.app.close();

    const dataDir = path.join(profile, "data");
    fs.mkdirSync(dataDir, { recursive: true });
    fs.copyFileSync(SOURCE_DB, path.join(dataDir, "prompthub.db"));

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
    await page.getByTestId("orchestrator-model-source-local").click();
    const start = page.getByTestId("orchestrator-engine-start");
    if ((await start.count()) > 0) await start.click();
    try {
      await expect(page.getByTestId("orchestrator-engine-start")).toHaveCount(0, {
        timeout: 300_000,
      });
    } catch (error) {
      const panel = await page
        .getByTestId("orchestrator-local-engine")
        .innerText()
        .catch(() => "<no panel>");
      console.error("ENGINE PANEL:", panel);
      throw error;
    }

    for (const [index, sample] of SAMPLES.entries()) {
      const started = Date.now();
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
        };
      }, { ...sample.input, sharedSemantics: sample.facts });
      const elapsedMs = Date.now() - started;
      if (!reply.ok) throw new Error(JSON.stringify(reply.error));

      expect(reply.status).toBe("complete");
      expect(reply.output.length).toBeGreaterThan(40);
      const lowered = reply.output.toLowerCase();
      const hits = sample.expect.filter((word) => lowered.includes(word.toLowerCase()));
      expect(hits.length).toBeGreaterThanOrEqual(1);
      if (sample.input.outputFormat === "h3") {
        expect(reply.output).toContain("integrated_multimodal_description");
      }
      report.runs.push({
        iteration: index + 1,
        label: sample.label,
        skill: sample.input.skill,
        outputFormat: sample.input.outputFormat,
        facts: sample.facts,
        elapsedMs,
        status: reply.status,
        output: reply.output,
        outputLength: reply.output.length,
        hits,
        warnings: reply.warnings,
        load: reply.load,
      });
      console.log(JSON.stringify({
        label: sample.label,
        elapsedMs,
        length: reply.output.length,
        hits,
        status: reply.status,
      }));
    }

    report.complete = true;
  } finally {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(OUTPUT_DIR, "shared-facts-five.json"),
      JSON.stringify(report, null, 2),
    );
    if (app) {
      await app.evaluate(() => window.api.localLlama.unload().catch(() => undefined)).catch(() => undefined);
      await closePromptHub(app, profile, { preserveUserDataDir: false });
    }
  }
});