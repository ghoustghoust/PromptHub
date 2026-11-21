/**
 * Prompt-dimension comparison for MTP on/off.
 *
 * Runs the same fixed prompt set against two server configurations (the model
 * and flags come from a saved local-llama config file, so both runs use the
 * product's real argument builder), then reports per-dimension speed and
 * whether the generated text is identical.
 *
 * Why identity matters: MTP is speculative decoding. With temperature 0 the
 * accepted tokens should match plain decoding; a non-identical output is a
 * numerical signal worth inspecting, even when the wording is equivalent.
 *
 * Usage (repository root):
 *   apps\desktop\node_modules\.bin\tsx.cmd scripts\compare-mtp-prompt-quality.ts ^
 *     --config-file <profile>\config\local-llama.json ^
 *     --repeats 3 --out outputs\mtp-prompt-quality-20261121
 *
 * Only the server processes started here are terminated; nothing else is touched.
 */

import { execFile, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildLocalLlamaArgs,
  normalizeLocalLlamaConfig,
} from "../apps/desktop/src/main/services/local-llama-args";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const START_TIMEOUT_MS = 180_000;

interface PromptCase {
  id: string;
  label: string;
  system: string;
  user: string;
}

const CASES: PromptCase[] = [
  {
    id: "character-scene",
    label: "人物 + 场景",
    system: "You write production-ready English image prompts. Output only the prompt.",
    user:
      "写一段用于 Flux 的英文提示词：一位银发少女坐在雨夜电车的最后一排，手里抱着旧相机，" +
      "窗外霓虹在水汽上反光。只输出英文提示词。",
  },
  {
    id: "photography",
    label: "专业摄影",
    system: "You are a portrait photography director. Output only the prompt.",
    user:
      "写一段英文拍摄提示词：85mm 镜头、f/1.8、侧逆光、深色背景，皮肤保留真实纹理。只输出提示词。",
  },
  {
    id: "light-material",
    label: "光影与材质",
    system: "You write precise lighting and material descriptions. Output only the prompt.",
    user:
      "写英文提示词，强调金属与丝绸的材质对比、暖色轮廓光与冷色环境光。只输出提示词。",
  },
  {
    id: "camera-composition",
    label: "镜头与构图",
    system: "You write camera and composition instructions. Output only the prompt.",
    user:
      "写英文提示词：低角度仰拍、广角、前景框架构图，主体位于三分线交点。只输出提示词。",
  },
  {
    id: "anime-tags",
    label: "动漫 Tags",
    system: "You output danbooru-style comma-separated English tags only.",
    user:
      "用 danbooru 风格英文 tag 描述：银发、红瞳、黑色水手服、雨中撑伞、回眸。逗号分隔，只输出 tags。",
  },
  {
    id: "polish",
    label: "提示词润色",
    system: "You polish prompts without changing their meaning. Output only the polished English prompt.",
    user:
      "润色以下提示词，保持原意，只输出润色后的英文：" +
      "a girl standing in a room with some lights and maybe rain outside, cinematic.",
  },
  {
    id: "reverse",
    label: "文字反推",
    system: "You reconstruct visible facts into an English image prompt. Do not add unseen details.",
    user:
      "根据这段画面描述反推为英文生图提示词，不要添加未描述的内容：" +
      "夜晚便利店门口，一个人蹲着系鞋带，冷白灯管，玻璃上有水汽。只输出提示词。",
  },
];

interface Sample {
  id: string;
  label: string;
  run: number;
  text: string;
  predictedPerSecond: number;
  promptPerSecond: number | null;
  wallMs: number;
  finishReason: string | null;
}

interface ConfigRun {
  name: string;
  mtpEnabled: boolean;
  flags: string[];
  coldStartMs: number;
  peakMemoryMb: number | null;
  samples: Sample[];
  error: string | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function memoryUsed(): Promise<number | null> {
  return new Promise((resolve) => {
    execFile(
      "nvidia-smi",
      ["--query-gpu=memory.used", "--format=csv,noheader,nounits"],
      { timeout: 5000 },
      (error, stdout) => {
        if (error) return resolve(null);
        const first = stdout.split(/\r?\n/).find((line) => line.trim());
        resolve(first ? Number(first.trim()) : null);
      },
    );
  });
}

/** Waits until the GPU is back near idle, so the next server can fit fully. */
async function waitForCleanGpu(limitMb = 3000): Promise<number | null> {
  let last: number | null = null;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    last = await memoryUsed();
    if (last !== null && last <= limitMb) return last;
    await sleep(500);
  }
  return last;
}

async function serverReady(base: string): Promise<boolean> {
  try {
    const response = await fetch(`${base}/v1/models`, { signal: AbortSignal.timeout(1500) });
    if (!response.ok) return false;
    const payload = (await response.json()) as { data?: unknown };
    return Array.isArray(payload.data);
  } catch {
    return false;
  }
}

async function waitForServer(base: string): Promise<number> {
  const started = Date.now();
  while (Date.now() - started < START_TIMEOUT_MS) {
    if (await serverReady(base)) return Date.now() - started;
    await sleep(300);
  }
  throw new Error(`server did not become ready within ${START_TIMEOUT_MS} ms`);
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.killed) return;
  child.kill("SIGTERM");
  const started = Date.now();
  while (Date.now() - started < 8000) {
    if (child.exitCode !== null) return;
    await sleep(200);
  }
  child.kill("SIGKILL");
}

async function generate(
  base: string,
  item: PromptCase,
  maxTokens: number,
  seed: number,
  run: number,
): Promise<Sample> {
  const started = Date.now();
  const response = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "prompthub-local",
      messages: [
        { role: "system", content: item.system },
        { role: "user", content: item.user },
      ],
      max_tokens: maxTokens,
      temperature: 0,
      seed,
      stream: false,
      // Matches the orchestrator client: PromptHub disables Qwen thinking mode.
      chat_template_kwargs: { enable_thinking: false },
    }),
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  const wallMs = Date.now() - started;
  if (!response.ok) {
    throw new Error(`${item.id}: completion failed ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
    timings?: { predicted_per_second?: number; prompt_per_second?: number };
  };
  return {
    id: item.id,
    label: item.label,
    run,
    text: payload.choices?.[0]?.message?.content?.trim() ?? "",
    predictedPerSecond: payload.timings?.predicted_per_second ?? 0,
    promptPerSecond: payload.timings?.prompt_per_second ?? null,
    wallMs,
    finishReason: payload.choices?.[0]?.finish_reason ?? null,
  };
}

async function runConfig(
  name: string,
  mtpEnabled: boolean,
  baseConfig: ReturnType<typeof normalizeLocalLlamaConfig>,
  outDir: string,
  maxTokens: number,
  seed: number,
  repeats: number,
): Promise<ConfigRun> {
  const config = { ...baseConfig, mtpEnabled };
  const flags = buildLocalLlamaArgs(config);
  const base = `http://127.0.0.1:${config.port}`;
  const run: ConfigRun = {
    name,
    mtpEnabled,
    flags,
    coldStartMs: 0,
    peakMemoryMb: null,
    samples: [],
    error: null,
  };
  if (await serverReady(base)) {
    run.error = `port ${config.port} already has a server`;
    return run;
  }
  const idleMemory = await waitForCleanGpu();
  console.log(`[${name}] GPU before start: ${idleMemory ?? "?"} MiB`);
  const logPath = path.join(outDir, `${name}-server.log`);
  const log = await fs.open(logPath, "w");
  const child = spawn(config.executablePath, flags, {
    cwd: path.dirname(config.executablePath),
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => void log.write(chunk));
  child.stderr.on("data", (chunk) => void log.write(chunk));
  const poll = setInterval(() => {
    void memoryUsed().then((used) => {
      if (used !== null && (run.peakMemoryMb === null || used > run.peakMemoryMb)) {
        run.peakMemoryMb = used;
      }
    });
  }, 250);
  try {
    run.coldStartMs = await waitForServer(base);
    console.log(`[${name}] ready in ${run.coldStartMs} ms`);
    // Warm the server once so the first measured case is not a cold request.
    await generate(base, CASES[0], 32, seed, 0);
    for (const item of CASES) {
      for (let repeat = 1; repeat <= repeats; repeat += 1) {
        const sample = await generate(base, item, maxTokens, seed, repeat);
        run.samples.push(sample);
      }
      const first = run.samples.find((sample) => sample.id === item.id && sample.run === 1);
      console.log(
        `[${name}] ${item.id}: ${first ? first.predictedPerSecond.toFixed(1) : "?"} t/s, ` +
        `${first ? first.text.length : "?"} chars`,
      );
    }
  } catch (error) {
    run.error = error instanceof Error ? error.message : String(error);
  } finally {
    clearInterval(poll);
    await stopServer(child);
    await log.close();
  }
  return run;
}

function commonPrefix(a: string, b: string): number {
  const limit = Math.min(a.length, b.length);
  let index = 0;
  while (index < limit && a[index] === b[index]) index += 1;
  return index;
}

function tokenOverlap(a: string, b: string): number {
  const left = new Set(a.toLowerCase().split(/[\s,]+/).filter(Boolean));
  const right = new Set(b.toLowerCase().split(/[\s,]+/).filter(Boolean));
  if (left.size === 0 && right.size === 0) return 1;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / Math.max(1, Math.max(left.size, right.size));
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function samplesFor(run: ConfigRun, id: string): Sample[] {
  return run.samples.filter((sample) => sample.id === id).sort((a, b) => a.run - b.run);
}

interface CaseComparison {
  id: string;
  label: string;
  baseline: Sample[];
  mtp: Sample[];
  identical: boolean;
  baselineStable: boolean;
  mtpStable: boolean;
  baselineMedian: number;
  mtpMedian: number;
}

function compareCases(baseline: ConfigRun, mtp: ConfigRun): CaseComparison[] {
  return CASES.map((item) => {
    const left = samplesFor(baseline, item.id);
    const right = samplesFor(mtp, item.id);
    return {
      id: item.id,
      label: item.label,
      baseline: left,
      mtp: right,
      identical: left[0]?.text === right[0]?.text,
      baselineStable: new Set(left.map((sample) => sample.text)).size === 1,
      mtpStable: new Set(right.map((sample) => sample.text)).size === 1,
      baselineMedian: median(left.map((sample) => sample.predictedPerSecond)),
      mtpMedian: median(right.map((sample) => sample.predictedPerSecond)),
    };
  });
}

function renderReport(
  baseline: ConfigRun,
  mtp: ConfigRun,
  meta: { head: string; model: string; maxTokens: number; seed: number; repeats: number; mmproj: boolean },
): string {
  const lines: string[] = [];
  const add = lines.push.bind(lines);
  const cases = compareCases(baseline, mtp);
  add("# MTP 提示词维度对比（质量与速度）");
  add("");
  add(`- 时间：${new Date().toISOString()}`);
  add(`- 提交：\`${meta.head}\``);
  add(`- 模型：\`${path.basename(meta.model)}\``);
  add(`- 参数：temperature 0 / seed ${meta.seed} / max_tokens ${meta.maxTokens} / 每维 ${meta.repeats} 次取中位`);
  add(`- mmproj：${meta.mmproj ? "已加载" : "未加载（纯文本测试）"}`);
  add("");
  add("## 汇总");
  add("");
  add("| 维度 | 输出一致 | 基线 t/s | MTP t/s | 提速 | 输出稳定（基线/MTP） | 字符数（基线 / MTP） |");
  add("| --- | --- | ---: | ---: | ---: | --- | --- |");
  for (const item of cases) {
    const speedup = item.baselineMedian > 0 ? item.mtpMedian / item.baselineMedian : 0;
    add(
      `| ${item.label} | ${item.identical ? "是" : "**否**"} | ` +
      `${item.baselineMedian.toFixed(1)} | ${item.mtpMedian.toFixed(1)} | ` +
      `${speedup > 0 ? `${speedup.toFixed(2)}×` : "—"} | ` +
      `${item.baselineStable ? "稳定" : "**波动**"} / ${item.mtpStable ? "稳定" : "**波动**"} | ` +
      `${item.baseline[0]?.text.length ?? 0} / ${item.mtp[0]?.text.length ?? 0} |`,
    );
  }
  const allBaseline = cases.flatMap((item) => item.baseline.map((sample) => sample.predictedPerSecond));
  const allMtp = cases.flatMap((item) => item.mtp.map((sample) => sample.predictedPerSecond));
  const baselineMedian = median(allBaseline);
  const mtpMedian = median(allMtp);
  add(
    `| **总体中位** | — | ${baselineMedian.toFixed(1)} | ${mtpMedian.toFixed(1)} | ` +
    `${baselineMedian > 0 ? `${(mtpMedian / baselineMedian).toFixed(2)}×` : "—"} | — | — |`,
  );
  add("");
  add("## 逐维度差异");
  add("");
  const differing = cases.filter((item) => !item.identical);
  if (differing.length === 0) {
    add("全部维度的首个输出逐字符一致。MTP 在温度 0 下没有改变文本。");
  } else {
    for (const item of differing) {
      const left = item.baseline[0]?.text ?? "";
      const right = item.mtp[0]?.text ?? "";
      add(
        `- **${item.label}**：首个差异在第 ${commonPrefix(left, right)} 字符，` +
        `token 重合度 ${(tokenOverlap(left, right) * 100).toFixed(1)}%。`,
      );
      add(`  - 基线结尾：…${left.slice(Math.max(0, left.length - 60))}`);
      add(`  - MTP 结尾：…${right.slice(Math.max(0, right.length - 60))}`);
    }
  }
  add("");
  add("## 输出样本（MTP）");
  add("");
  for (const item of cases) {
    const sample = item.mtp[0];
    if (!sample) continue;
    add(`### ${item.label}`);
    add("");
    add(
      `- 基线 ${item.baselineMedian.toFixed(1)} t/s / MTP ${item.mtpMedian.toFixed(1)} t/s / ` +
      `输出 ${sample.text.length} 字符`,
    );
    add("");
    add("```text");
    add(sample.text.slice(0, 700));
    add("```");
    add("");
  }
  add("## 启动与显存");
  add("");
  add("| 配置 | 冷启动 ms | 峰值显存 MiB | 错误 |");
  add("| --- | ---: | ---: | --- |");
  add(`| 基线 | ${baseline.coldStartMs} | ${baseline.peakMemoryMb ?? "—"} | ${baseline.error ?? "无"} |`);
  add(`| MTP | ${mtp.coldStartMs} | ${mtp.peakMemoryMb ?? "—"} | ${mtp.error ?? "无"} |`);
  add("");
  add("## 边界");
  add("");
  add("- 每个配置单独启动 server，结束后由脚本终止；使用与桌面端相同的参数构建函数。");
  add("- temperature 0 + 固定 seed；MTP 属投机解码，理论上应接近确定性输出，差异需按语义复核。");
  add("- 生成速度取决于输出长度：提示词类回答通常只有几十 token，MTP 的草稿收益不如长文生成。");
  add("- 这里评估的是模型输出层，不含 PromptHub 规则卡与词库编排的额外影响。");
  add("- 维度样本 7 个、每维重复有限；结论不外推到全部题材。");
  add("- MTP 启动日志可能出现 `failed to fit params ... n_gpu_layers already set by user to 99, abort`：这是固定 ngl 后放弃自动分配，不代表降级；实际速度以本表为准。");
  add("");
  return lines.join("\n");
}

async function gitHead(): Promise<string> {
  return new Promise((resolve) => {
    execFile("git", ["rev-parse", "HEAD"], { cwd: ROOT }, (error, stdout) => {
      resolve(error ? "unknown" : stdout.trim());
    });
  });
}

function parse(argv: string[]): {
  configFile: string;
  out: string;
  maxTokens: number;
  seed: number;
  repeats: number;
  noMmproj: boolean;
} {
  const read = (name: string, fallback: string): string => {
    const index = argv.indexOf(`--${name}`);
    return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
  };
  return {
    configFile: read("config-file", ""),
    out: read("out", path.join(ROOT, "outputs", `mtp-prompt-quality-${new Date().toISOString().slice(0, 10)}`)),
    maxTokens: Number(read("max-tokens", "260")),
    seed: Number(read("seed", "42")),
    repeats: Math.max(1, Number(read("repeats", "3"))),
    noMmproj: argv.includes("--no-mmproj"),
  };
}

async function main(): Promise<void> {
  const args = parse(process.argv.slice(2));
  if (!args.configFile) throw new Error("--config-file is required");
  const raw = JSON.parse(await fs.readFile(args.configFile, "utf8")) as unknown;
  const parsedConfig = normalizeLocalLlamaConfig(raw);
  const baseConfig = args.noMmproj
    ? { ...parsedConfig, mmprojPath: "" }
    : parsedConfig;
  if (!baseConfig.executablePath || !baseConfig.modelPath) {
    throw new Error("config file must contain executablePath and modelPath");
  }
  await fs.mkdir(args.out, { recursive: true });

  const baseline = await runConfig(
    "baseline", false, baseConfig, args.out, args.maxTokens, args.seed, args.repeats,
  );
  const mtp = await runConfig(
    "mtp", true, baseConfig, args.out, args.maxTokens, args.seed, args.repeats,
  );

  const report = renderReport(baseline, mtp, {
    head: await gitHead(),
    model: baseConfig.modelPath,
    maxTokens: args.maxTokens,
    seed: args.seed,
    repeats: args.repeats,
    mmproj: !args.noMmproj,
  });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await fs.writeFile(path.join(args.out, `report-${stamp}.md`), report, "utf8");
  await fs.writeFile(
    path.join(args.out, `report-${stamp}.json`),
    JSON.stringify({ cases: CASES, baseline, mtp }, null, 2),
    "utf8",
  );
  const cases = compareCases(baseline, mtp);
  const identical = cases.filter((item) => item.identical).length;
  const baselineMedian = median(cases.flatMap((item) => item.baseline.map((sample) => sample.predictedPerSecond)));
  const mtpMedian = median(cases.flatMap((item) => item.mtp.map((sample) => sample.predictedPerSecond)));
  console.log(JSON.stringify({
    out: args.out,
    identical: `${identical}/${cases.length}`,
    baselineTps: Number(baselineMedian.toFixed(1)),
    mtpTps: Number(mtpMedian.toFixed(1)),
    speedup: baselineMedian > 0 ? Number((mtpMedian / baselineMedian).toFixed(2)) : null,
    errors: { baseline: baseline.error, mtp: mtp.error },
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
