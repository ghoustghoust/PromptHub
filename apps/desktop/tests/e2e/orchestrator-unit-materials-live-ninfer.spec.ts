import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type {
  LocalLlamaEngineConfig,
  PromptOrchestrationInput,
  PromptUnitMaterials,
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
const OUTPUT_DIR = path.resolve(__dirname, "../../../../outputs/prompt-new-branch1l-20261128");

const STORYBOARD = [
  "分镜1: 大远景，雨夜市场街，信使从画面左侧走入。",
  "分镜2: 中景，信使停在摊位雨棚下，抬手护住信封。",
  "分镜3: 近景，信封封口特写，雨水顺着手指滴落。",
  "分镜4: 中景，信使抬头看向空摊位，灯管闪烁。",
].join("\n");

type Materials = PromptUnitMaterials;

interface Sample {
  name: string;
  prompt: string;
  durationSeconds: number;
  shotCount: number;
  materials: Materials;
}

const SAMPLES: Sample[] = [
  {
    name: "first-frame",
    prompt: "把这场分镜写成 8 秒视频提示词：第一镜从已给定的首帧继续，三镜，给声音。",
    durationSeconds: 8,
    shotCount: 3,
    materials: { mode: "first-frame", slots: [{ kind: "first-frame" }] },
  },
  {
    name: "first-last",
    prompt: "这一单元首尾帧都已给定：开场接首帧，最后一镜必须落在尾帧上，10 秒四镜，给声音。",
    durationSeconds: 10,
    shotCount: 4,
    materials: {
      mode: "first-last",
      slots: [{ kind: "first-frame" }, { kind: "last-frame" }],
    },
  },
  {
    name: "references-three",
    prompt: "用三张参考图锁定人物造型，写 6 秒两镜的视频提示词，雨夜市场街不变。",
    durationSeconds: 6,
    shotCount: 2,
    materials: {
      mode: "references",
      referenceCount: 3,
      slots: [
        { kind: "reference", index: 1 },
        { kind: "reference", index: 2 },
        { kind: "reference", index: 3 },
      ],
    },
  },
  {
    name: "text-only-control",
    prompt: "纯文字生成，不需要任何参考图：12 秒五镜，雨夜市场街，信使等不到人。",
    durationSeconds: 12,
    shotCount: 5,
    materials: { mode: "text", slots: [] },
  },
  {
    name: "first-frame-long",
    prompt: "从首帧继续，写 15 秒六镜的完整单元，包含雨声、远处车流与灯管电流声。",
    durationSeconds: 15,
    shotCount: 6,
    materials: { mode: "first-frame", slots: [{ kind: "first-frame" }] },
  },
];

const MATERIAL_WORDS = ["首帧", "尾帧", "参考图", "frame", "reference"];

test("unit stage follows the declared material branch on the real engine", async () => {
  test.setTimeout(1_800_000);
  const source = JSON.parse(fs.readFileSync(SOURCE_CONFIG, "utf8")) as LocalLlamaEngineConfig;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prompthub-unit-materials-"));
  const profile = path.join(root, "profile");
  const report: {
    runs: Array<Record<string, unknown>>;
    complete: boolean;
  } = { runs: [], complete: false };
  const failures: string[] = [];
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

    for (const [index, sample] of SAMPLES.entries()) {
      const started = Date.now();
      const input: PromptOrchestrationInput = {
        prompt: sample.prompt,
        mode: "video-text",
        skill: "minimaxH3",
        outputFormat: "h3",
        guidanceMode: "agent-led",
        systemPromptLayerContextSize: 32768,
        video: { durationSeconds: sample.durationSeconds, shotCount: sample.shotCount },
        stage: "unit",
        shotCount: sample.shotCount,
        stepContext: STORYBOARD,
        unitMaterials: sample.materials,
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
        };
      }, input);
      const elapsedMs = Date.now() - started;
      if (!reply.ok) throw new Error(JSON.stringify(reply.error));

      const timed = /(\d+(?:\.\d+)?)\s*(?:s|秒)/i.test(reply.output);
      const sounds = /(sound|audio|soundscape|声音|音效|雨声|环境声)/i.test(reply.output);
      const materialWords = MATERIAL_WORDS.filter((word) =>
        reply.output.toLowerCase().includes(word.toLowerCase()),
      );
      report.runs.push({
        iteration: index + 1,
        name: sample.name,
        mode: sample.materials.mode,
        durationSeconds: sample.durationSeconds,
        shotCount: sample.shotCount,
        elapsedMs,
        status: reply.status,
        outputLength: reply.output.length,
        hasTimeRange: timed,
        hasSound: sounds,
        materialWords,
        warnings: reply.warnings,
        output: reply.output,
      });

      // Record every sample first, then judge the batch: a single failure must
      // not hide what the other material branches actually did.
      if (reply.status !== "complete" || reply.output.length < 60 || !timed || !sounds) {
        failures.push(sample.name);
      }
    }

    expect(failures).toEqual([]);
    report.complete = true;
  } finally {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(OUTPUT_DIR, "unit-materials-live.json"),
      JSON.stringify(report, null, 2),
    );
    if (app) {
      await app
        .evaluate(() => window.api.localLlama.unload().catch(() => undefined))
        .catch(() => undefined);
      await closePromptHub(app, profile, { preserveUserDataDir: false });
    }
  }
});