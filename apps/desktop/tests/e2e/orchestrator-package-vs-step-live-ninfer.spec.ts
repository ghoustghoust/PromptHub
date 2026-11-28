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

const PACK_RULE_TITLE = "剧本结构方法";
const PACK_NAME = "Skill-Film-Method-Pack";
const PACK_RULE =
  "每场必须包含目标、障碍、转折三种要素；场景结尾必须留下一个可拍摄的具体动作，不得以情绪总结收尾。";

const module = {
  id: "module-script-structure",
  moduleKey: "script-structure",
  title: PACK_RULE_TITLE,
  content: PACK_RULE,
  layer: "H" as const,
  packId: "pack-skill-film",
  packName: PACK_NAME,
  tokens: 60,
};

const SAMPLES: Array<{
  label: string;
  stepContext: string;
  facts: PromptSharedSemantics;
  input: Omit<PromptOrchestrationInput, "llmModelId" | "knowledgeModules" | "stepContext">;
  expectFacts: string[];
}> = [
  {
    label: "moss-expand",
    stepContext: "OUTLINE: 信使在雨夜穿过市场街，信封里的地址指向一间关闭的当铺。",
    facts: {
      subject: "a courier in a soaked coat",
      action: "checking a sealed envelope under an awning",
      setting: "market street, midnight",
      lighting: "one bare bulb over the stall",
    },
    input: {
      prompt: "写第 3 场的画面提示词，从大纲出发。",
      mode: "expand",
      skill: "moss",
      outputFormat: "caption",
      guidanceMode: "agent-led",
      systemPromptLayerContextSize: 32768,
    },
    expectFacts: ["courier", "envelope", "street"],
  },
  {
    label: "k2-expand",
    stepContext: "BEATS: 1) 灯下停步 2) 检查封口 3) 有人喊名字 4) 转身跑进侧巷。",
    facts: {
      subject: "a courier and a caller in the rain",
      action: "one turns into a side alley",
      setting: "narrow side alley behind the market",
      composition: "wide, deep perspective",
    },
    input: {
      prompt: "把这几拍写成一个连续镜头。",
      mode: "expand",
      skill: "k2",
      outputFormat: "caption",
      guidanceMode: "agent-led",
      systemPromptLayerContextSize: 32768,
    },
    expectFacts: ["alley", "rain", "courier"],
  },
  {
    label: "k2-polish",
    stepContext:
      "INT. 当铺 - 夜\n卷帘门半开。信使把信封塞进门缝，里面有人用指节敲了两下门板作为回应。",
    facts: {
      subject: "a courier at a half-open shutter",
      action: "sliding an envelope under the door",
      setting: "pawnshop entrance, night",
      lighting: "streetlight spill",
    },
    input: {
      prompt: "润色这一段，只修连贯性和镜头感，不要改写事件。",
      mode: "polish",
      skill: "k2",
      outputFormat: "caption",
      guidanceMode: "human-led",
      systemPromptLayerContextSize: 32768,
    },
    expectFacts: ["envelope", "shutter", "knock"],
  },
  {
    label: "moody-expand",
    stepContext: "SCENE: 侧巷尽头的铁门后传来收音机声，信使停住，没有敲门。",
    facts: {
      subject: "a courier listening at an iron door",
      action: "standing still, hand raised but not knocking",
      setting: "dead-end alley with a radio behind the door",
      lighting: "cold blue, one distant sodium lamp",
      palette: "blue and rust",
    },
    input: {
      prompt: "写这一场的氛围提示词。",
      mode: "expand",
      skill: "moodyMoss",
      outputFormat: "caption",
      guidanceMode: "agent-led",
      systemPromptLayerContextSize: 32768,
    },
    expectFacts: ["door", "alley", "radio"],
  },
  {
    label: "h3-expand",
    stepContext: "SHOT 4: 信使转身冲进雨里，镜头跟随，信封仍攥在手里。8 秒。",
    facts: {
      subject: "a courier sprinting through rain",
      action: "turning and running, envelope in hand",
      setting: "market street turning into an alley",
      composition: "tracking shot, subject centred",
      continuity: "same coat and envelope as shot 3",
    },
    input: {
      prompt: "把这一拍写成视频提示词。",
      mode: "video-text",
      skill: "minimaxH3",
      outputFormat: "h3",
      guidanceMode: "agent-led",
      video: { durationSeconds: 8, shotCount: 1 },
      systemPromptLayerContextSize: 32768,
    },
    expectFacts: ["courier", "rain", "envelope"],
  },
];

test("package rules and step material stay separate in five real runs", async () => {
  test.setTimeout(1_800_000);
  const source = JSON.parse(fs.readFileSync(SOURCE_CONFIG, "utf8")) as LocalLlamaEngineConfig;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prompthub-step-material-"));
  const profile = path.join(root, "profile");
  const report: { runs: Array<Record<string, unknown>>; leaks: string[]; complete: boolean } = {
    runs: [],
    leaks: [],
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
    await expect(page.getByTestId("orchestrator-engine-start")).toHaveCount(0, {
      timeout: 300_000,
    });

    await page.getByTestId("orchestrator-step-context-toggle").click();
    await page.getByTestId("orchestrator-step-context-input").fill(SAMPLES[0].stepContext);

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
          warnings: response.data.warnings.slice(0, 4),
        };
      }, { ...sample.input, sharedSemantics: sample.facts, stepContext: sample.stepContext, knowledgeModules: [module] });
      const elapsedMs = Date.now() - started;
      if (!reply.ok) throw new Error(JSON.stringify(reply.error));

      expect(reply.status).toBe("complete");
      expect(reply.output.length).toBeGreaterThan(40);
      const lowered = reply.output.toLowerCase();
      const hits = sample.expectFacts.filter((word) => lowered.includes(word.toLowerCase()));
      expect(hits.length).toBeGreaterThanOrEqual(1);

      const leak = [PACK_RULE_TITLE, PACK_NAME, "module-script-structure", "layer: H"].filter(
        (token) => reply.output.includes(token),
      );
      if (leak.length > 0) report.leaks.push(`${sample.label}: ${leak.join(", ")}`);
      expect(leak).toEqual([]);

      report.runs.push({
        iteration: index + 1,
        label: sample.label,
        skill: sample.input.skill,
        mode: sample.input.mode,
        stepContext: sample.stepContext,
        elapsedMs,
        status: reply.status,
        output: reply.output,
        outputLength: reply.output.length,
        facts: hits,
        warnings: reply.warnings,
      });
      console.log(JSON.stringify({
        label: sample.label,
        elapsedMs,
        length: reply.output.length,
        facts: hits,
        leaks: leak,
      }));
    }

    report.complete = true;
  } finally {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(OUTPUT_DIR, "package-vs-step-five.json"),
      JSON.stringify(report, null, 2),
    );
    if (app) {
      await app.evaluate(() => window.api.localLlama.unload().catch(() => undefined)).catch(() => undefined);
      await closePromptHub(app, profile, { preserveUserDataDir: false });
    }
  }
});