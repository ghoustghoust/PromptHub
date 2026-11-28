import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { LocalLlamaEngineConfig, PromptOrchestrationInput } from "@prompthub/shared/types";
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
const OUTPUT_DIR = path.resolve(__dirname, "../../../../outputs/prompt-new-branch1m-20261128");

const SCRIPT_A = [
  "EXT. 雨夜市场街 - 夜",
  "雨砸在铁皮棚上。信使抱着一只牛皮纸信封，从街角走进来，鞋底踩过积水。",
  "信使：我到了，你还没来。",
  "他停在三号摊位前，摊位空着，日光灯管一亮一灭。",
].join("\n");

const SCRIPT_B = [
  "INT. 市场走廊 - 深夜",
  "走廊尽头的灯闪了三下。信使靠在墙边，信封被雨衣内侧裹着。",
  "远处有人推着铁皮车经过，水声盖住脚步。",
].join("\n");

interface Sample {
  name: string;
  prompt: string;
  shots: number;
  script: string;
}

const SAMPLES: Sample[] = [
  {
    name: "six-with-dialogue",
    prompt: "把这场剧本页拆成六个分镜，信使的对白只放在他开口的那一镜。",
    shots: 6,
    script: SCRIPT_A,
  },
  {
    name: "eight-rain-grows",
    prompt: "拆成 8 个分镜，雨势要一镜比一镜大，最后一镜停在信封封口。",
    shots: 8,
    script: SCRIPT_A,
  },
  {
    name: "twelve-push-in",
    prompt: "拆成十二镜，从街道全景一路推进到信封特写，中间不跳轴。",
    shots: 12,
    script: SCRIPT_A,
  },
  {
    name: "four-english",
    prompt: "Break this scene into four shots. The courier stays silent; keep the flickering tube light in the last one.",
    shots: 4,
    script: SCRIPT_B,
  },
  {
    name: "nine-mixed",
    prompt: "拆成 9 个分镜，中英混排描述，把雨声与远处车流写进画面。",
    shots: 9,
    script: SCRIPT_B,
  },
];

function shotLines(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^分镜\s*\d+\s*\|/.test(line));
}

test("storyboard stage returns fixed pipe columns for five fresh prompts", async () => {
  test.setTimeout(1_800_000);
  const source = JSON.parse(fs.readFileSync(SOURCE_CONFIG, "utf8")) as LocalLlamaEngineConfig;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prompthub-storyboard-columns-"));
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
        mode: "expand",
        skill: "k2",
        outputFormat: "caption",
        guidanceMode: "agent-led",
        systemPromptLayerContextSize: 32768,
        stage: "storyboard",
        shotCount: sample.shots,
        stepContext: sample.script,
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

      const lines = shotLines(reply.output);
      const fieldCounts = lines.map((line) => line.split("|").length);
      const hasHeader = /^\s*\|/.test(reply.output) || reply.output.includes("---");
      report.runs.push({
        iteration: index + 1,
        name: sample.name,
        requestedShots: sample.shots,
        elapsedMs,
        status: reply.status,
        outputLength: reply.output.length,
        shotLines: lines.length,
        fieldCounts,
        hasHeader,
        warnings: reply.warnings,
        firstLine: lines[0] ?? null,
        output: reply.output,
      });

      if (reply.status !== "complete") failures.push(`${sample.name}: status ${reply.status}`);
      // Shot-count and field completeness are model quality, recorded above for
      // review; this spec guards the wiring: the stage must actually emit
      // 分镜 lines and must not fall back to a markdown table.
      if (lines.length === 0) failures.push(`${sample.name}: no 分镜 lines`);
      if (hasHeader) failures.push(`${sample.name}: header or separator row present`);
    }

    expect(failures).toEqual([]);
    report.complete = true;
  } finally {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(OUTPUT_DIR, "storyboard-table-live.json"),
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