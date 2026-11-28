import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type {
  LocalLlamaEngineConfig,
  PromptOrchestrationInput,
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

const PACK_TITLE = "剧本结构方法";
const PACK_NAME = "Skill-Film-Method-Pack";
const module = {
  id: "module-script-structure",
  moduleKey: "script-structure",
  title: PACK_TITLE,
  content:
    "每场必须包含目标、障碍、转折三种要素；场景结尾必须留下一个可拍摄的具体动作，不得以情绪总结收尾。",
  layer: "H" as const,
  packId: "pack-skill-film",
  packName: PACK_NAME,
  tokens: 60,
};

const FACTS = ["courier", "envelope", "market", "rain"];

interface StageRun {
  stage: "outline" | "script" | "storyboard" | "unit";
  intent: string;
  input: Omit<PromptOrchestrationInput, "llmModelId" | "stepContext" | "knowledgeModules">;
  expect: string[];
}

const STAGES: StageRun[] = [
  {
    stage: "outline",
    intent:
      "写一个四拍大纲，每拍一句话：信使在雨夜市场街送一封密封的信，收信人不在，他决定等。",
    input: {
      prompt:
        "写一个四拍大纲，每拍一句话：信使在雨夜市场街送一封密封的信，收信人不在，他决定等。",
      mode: "expand",
      skill: "k2",
      outputFormat: "caption",
      guidanceMode: "agent-led",
      systemPromptLayerContextSize: 32768,
    },
    expect: ["信使", "courier", "信封", "envelope"],
  },
  {
    stage: "script",
    intent: "把大纲写成一场剧本：场景标题、动作行、一到两句对白。",
    input: {
      prompt: "把大纲写成一场剧本：场景标题、动作行、一到两句对白。",
      mode: "expand",
      skill: "k2",
      outputFormat: "caption",
      guidanceMode: "agent-led",
      systemPromptLayerContextSize: 32768,
    },
    expect: ["信使", "courier", "信封", "envelope"],
  },
  {
    stage: "storyboard",
    intent: "把剧本拆成六个分镜，每个分镜写景别、机位、主体动作。",
    input: {
      prompt: "把剧本拆成六个分镜，每个分镜写景别、机位、主体动作。",
      mode: "expand",
      skill: "k2",
      outputFormat: "caption",
      guidanceMode: "agent-led",
      systemPromptLayerContextSize: 32768,
    },
    expect: ["信使", "courier", "分镜", "shot"],
  },
  {
    stage: "unit",
    intent: "把分镜前三镜写成一段 8 秒视频提示词。",
    input: {
      prompt: "把分镜前三镜写成一段 8 秒视频提示词。",
      mode: "video-text",
      skill: "minimaxH3",
      outputFormat: "h3",
      guidanceMode: "agent-led",
      video: { durationSeconds: 8, shotCount: 1 },
      systemPromptLayerContextSize: 32768,
    },
    expect: ["courier", "信使", "rain", "雨"],
  },
];

test("all four script stages run on the real engine and chain their versions", async () => {
  test.setTimeout(1_800_000);
  const source = JSON.parse(fs.readFileSync(SOURCE_CONFIG, "utf8")) as LocalLlamaEngineConfig;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prompthub-stages-"));
  const profile = path.join(root, "profile");
  const report: {
    runs: Array<Record<string, unknown>>;
    flow?: unknown;
    leaks: string[];
    complete: boolean;
  } = { runs: [], leaks: [], complete: false };
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

    await page.getByTestId("orchestrator-script-flow-toggle").click();
    await page.getByTestId("orchestrator-step-context-toggle").click();

    let previousOutput: string | null = null;
    for (const [index, stage] of STAGES.entries()) {
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
        };
      }, {
        ...stage.input,
        stepContext: previousOutput ?? undefined,
        knowledgeModules: [module],
      });
      const elapsedMs = Date.now() - started;
      if (!reply.ok) throw new Error(JSON.stringify(reply.error));

      expect(reply.status).toBe("complete");
      expect(reply.output.length).toBeGreaterThan(60);
      const lowered = reply.output.toLowerCase();
      const hits = stage.expect.filter((word) => lowered.includes(word));
      expect(hits.length).toBeGreaterThanOrEqual(1);
      const leaks = [PACK_TITLE, PACK_NAME, "module-script-structure", "layer: H"].filter(
        (token) => reply.output.includes(token),
      );
      if (leaks.length > 0) report.leaks.push(`${stage.stage}: ${leaks.join(", ")}`);
      expect(leaks).toEqual([]);

      // A stage must transform its upstream material, not echo it.
      if (stage.stage === "script" && previousOutput) {
        expect(reply.output).not.toBe(previousOutput);
        expect(reply.output.length).toBeGreaterThan(previousOutput.length);
      }
      if (stage.stage === "storyboard") {
        const shots = (reply.output.match(/分镜|shot/gi) ?? []).length;
        expect(shots).toBeGreaterThanOrEqual(3);
      }

      // Save the produced text as this stage's version through the panel.
      await page.getByTestId(`orchestrator-script-stage-${stage.stage}`).click();
      await page.getByTestId("orchestrator-script-draft").fill(reply.output);
      await page.getByTestId("orchestrator-script-save").click();
      await expect(page.getByTestId("orchestrator-script-load-1")).toBeVisible();

      if (index > 0 && previousOutput) {
        // Carry the previous stage into the step material the way the UI does.
        await page.getByTestId(`orchestrator-script-stage-${STAGES[index - 1].stage}`).click();
        await page.getByTestId("orchestrator-script-load-1").click();
        await expect(page.getByTestId("orchestrator-step-context-input")).toHaveValue(
          previousOutput,
        );
        await page.getByTestId(`orchestrator-script-stage-${stage.stage}`).click();
      }

      report.runs.push({
        iteration: index + 1,
        stage: stage.stage,
        skill: stage.input.skill,
        mode: stage.input.mode,
        intent: stage.intent,
        stepContextLength: previousOutput?.length ?? 0,
        elapsedMs,
        status: reply.status,
        outputLength: reply.output.length,
        facts: hits,
        warnings: reply.warnings,
        output: reply.output,
      });
      console.log(
        JSON.stringify({
          stage: stage.stage,
          elapsedMs,
          length: reply.output.length,
          facts: hits,
          stepContextLength: previousOutput?.length ?? 0,
        }),
      );
      previousOutput = reply.output;
    }

    report.flow = await page.evaluate(async () => {
      const reply = await window.api.promptOrchestrator.getScriptFlow();
      return reply.ok === true ? reply.data : null;
    });

    const flow = report.flow as {
      versions: Record<string, Array<{ version: number; basedOn?: Record<string, number> }>>;
    };
    expect(flow.versions.outline).toHaveLength(1);
    expect(flow.versions.script[0].basedOn).toEqual({ outline: 1 });
    expect(flow.versions.storyboard[0].basedOn).toEqual({ script: 1 });
    expect(flow.versions.unit[0].basedOn).toEqual({ storyboard: 1 });
    expect(report.leaks).toEqual([]);

    const shot = await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      const image = await win.webContents.capturePage();
      return image.toPNG().toString("base64");
    });
    fs.writeFileSync(
      path.join(OUTPUT_DIR, "four-stages-panel.png"),
      Buffer.from(shot, "base64"),
    );
    report.complete = true;
  } finally {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(OUTPUT_DIR, "four-stages.json"),
      JSON.stringify(report, null, 2),
    );
    if (app) {
      await app.evaluate(() => window.api.localLlama.unload().catch(() => undefined)).catch(() => undefined);
      await closePromptHub(app, profile, { preserveUserDataDir: false });
    }
  }
});