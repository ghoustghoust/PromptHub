/**
 * MTP control benchmark for the local llama-server.
 *
 * Runs the exact flag set the desktop app uses (buildLocalLlamaArgs) for each
 * configuration, with one server process at a time, so the MTP on/off numbers
 * are comparable instead of remembered from different sessions.
 *
 * Preconditions:
 * - ComfyUI or any other GPU workload is stopped; the harness does not stop it.
 * - Nothing is listening on the benchmark port (the app's own engine included).
 * - The model supports MTP draft decoding when the mtp configuration is used.
 *
 * Usage (repository root):
 *   apps\desktop\node_modules\.bin\tsx.cmd scripts\benchmark-local-llm.ts ^
 *     --exe D:\tools\llama.cpp\llama-server.exe ^
 *     --model D:\models\model.gguf ^
 *     --configs baseline,mtp --runs 3 --n-predict 512
 *
 * Attach mode (measure an already running server, one configuration only):
 *   apps\desktop\node_modules\.bin\tsx.cmd scripts\benchmark-local-llm.ts --attach http://127.0.0.1:8080 --label mtp
 *
 * The harness only ever terminates the child process it started itself.
 */

import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_LOCAL_LLAMA_CONFIG,
  buildLocalLlamaArgs,
} from "../apps/desktop/src/main/services/local-llama-args";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_PROMPT =
  "请用中文详细解释 Transformer 中的自注意力机制：说明 Q、K、V 的作用，" +
  "缩放点积注意力的计算过程，多头注意力如何组合不同子空间，" +
  "以及位置编码为什么必要。请给出一个具体例子并逐步推导。";
const START_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 300;

interface Args {
  exe: string;
  model: string;
  mmproj: string;
  port: number;
  context: number;
  gpuLayers: number;
  draftMax: number;
  configs: string[];
  runs: number;
  warmup: number;
  nPredict: number;
  prompt: string;
  promptFile: string;
  out: string;
  label: string;
  attach: string;
  keepServer: boolean;
}

interface RunRecord {
  run: number;
  promptTokens: number | null;
  predictedTokens: number | null;
  promptPerSecond: number | null;
  predictedPerSecond: number;
  measuredByTimings: boolean;
  wallMs: number;
  peakMemoryMb: number | null;
  finishReason: string | null;
}

interface ConfigResult {
  name: string;
  flags: string[];
  mtpEnabled: boolean;
  coldStartMs: number | null;
  baselineMemoryMb: number | null;
  loadedMemoryMb: number | null;
  peakMemoryMb: number | null;
  releasedMemoryMb: number | null;
  runs: RunRecord[];
  medianPredictedPerSecond: number;
  medianPromptPerSecond: number | null;
  medianWallMs: number;
  error: string | null;
}

function parseArgs(argv: string[]): Args {
  const read = (name: string, fallback: string): string => {
    const index = argv.indexOf(`--${name}`);
    return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
  };
  const number = (name: string, fallback: number, allowZero = false): number => {
    const value = Number(read(name, String(fallback)));
    if (!Number.isFinite(value) || value < (allowZero ? 0 : 1)) {
      throw new Error(`--${name} must be ${allowZero ? "zero or more" : "a positive number"}`);
    }
    return value;
  };
  return {
    exe: read("exe", process.env.PROMPTHUB_LLAMA_SERVER ?? ""),
    model: read("model", process.env.PROMPTHUB_MODEL_PATH ?? ""),
    mmproj: read("mmproj", process.env.PROMPTHUB_MMPROJ_PATH ?? ""),
    port: number("port", 8080),
    context: number("ctx", DEFAULT_LOCAL_LLAMA_CONFIG.contextSize),
    gpuLayers: Number(read("ngl", String(DEFAULT_LOCAL_LLAMA_CONFIG.gpuLayers))),
    draftMax: number("draft-max", DEFAULT_LOCAL_LLAMA_CONFIG.mtpDraftMax),
    configs: read("configs", "baseline,mtp").split(",").map((item) => item.trim()).filter(Boolean),
    runs: number("runs", 3),
    warmup: number("warmup", 1, true),
    nPredict: number("n-predict", 512),
    prompt: read("prompt", DEFAULT_PROMPT),
    promptFile: read("prompt-file", ""),
    out: read("out", ""),
    label: read("label", ""),
    attach: read("attach", ""),
    keepServer: argv.includes("--keep-server"),
  };
}

function baseUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

async function queryGpu(): Promise<{ name: string; totalMb: number; usedMb: number } | null> {
  return new Promise((resolve) => {
    execFile(
      "nvidia-smi",
      ["--query-gpu=name,memory.total,memory.used", "--format=csv,noheader,nounits"],
      { timeout: 5000 },
      (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }
        const first = stdout.split(/\r?\n/).find((line) => line.trim());
        if (!first) {
          resolve(null);
          return;
        }
        const [name, total, used] = first.split(",").map((part) => part.trim());
        resolve({
          name,
          totalMb: Number(total),
          usedMb: Number(used),
        });
      },
    );
  });
}

async function memoryUsed(): Promise<number | null> {
  const gpu = await queryGpu();
  return gpu ? gpu.usedMb : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function serverReady(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/v1/models`, { signal: AbortSignal.timeout(1500) });
    if (!response.ok) return false;
    const payload = (await response.json()) as { data?: unknown };
    return Array.isArray(payload.data);
  } catch {
    return false;
  }
}

async function waitForServer(url: string, timeoutMs: number): Promise<number> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await serverReady(url)) return Date.now() - started;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`server did not become ready within ${timeoutMs} ms`);
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
  url: string,
  prompt: string,
  nPredict: number,
): Promise<RunRecord> {
  const started = Date.now();
  let peak: number | null = null;
  const poll = setInterval(() => {
    void memoryUsed().then((used) => {
      if (used !== null && (peak === null || used > peak)) peak = used;
    });
  }, 250);
  try {
    const response = await fetch(`${url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "prompthub-local",
        messages: [{ role: "user", content: prompt }],
        max_tokens: nPredict,
        temperature: 0,
        stream: false,
      }),
      signal: AbortSignal.timeout(30 * 60 * 1000),
    });
    const wallMs = Date.now() - started;
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`completion failed ${response.status}: ${body.slice(0, 300)}`);
    }
    const payload = (await response.json()) as {
      choices?: Array<{ finish_reason?: string }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      timings?: {
        prompt_n?: number;
        predicted_n?: number;
        prompt_per_second?: number;
        predicted_per_second?: number;
      };
    };
    const timings = payload.timings ?? {};
    const predictedTokens = timings.predicted_n ?? payload.usage?.completion_tokens ?? null;
    const promptTokens = timings.prompt_n ?? payload.usage?.prompt_tokens ?? null;
    const measuredByTimings =
      typeof timings.predicted_per_second === "number" && timings.predicted_per_second > 0;
    const predictedPerSecond = measuredByTimings
      ? (timings.predicted_per_second as number)
      : predictedTokens && wallMs > 0
        ? (predictedTokens / wallMs) * 1000
        : 0;
    return {
      run: 0,
      promptTokens,
      predictedTokens,
      promptPerSecond:
        typeof timings.prompt_per_second === "number" ? timings.prompt_per_second : null,
      predictedPerSecond,
      measuredByTimings,
      wallMs,
      peakMemoryMb: peak,
      finishReason: payload.choices?.[0]?.finish_reason ?? null,
    };
  } finally {
    clearInterval(poll);
  }
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

async function runConfig(
  args: Args,
  name: string,
  prompt: string,
): Promise<ConfigResult> {
  const mtpEnabled = name === "mtp";
  const config = {
    ...DEFAULT_LOCAL_LLAMA_CONFIG,
    executablePath: args.exe,
    modelPath: args.model,
    mmprojPath: args.mmproj,
    port: args.port,
    contextSize: args.context,
    gpuLayers: args.gpuLayers,
    mtpEnabled,
    mtpDraftMax: args.draftMax,
  };
  const flags = buildLocalLlamaArgs(config);
  const result: ConfigResult = {
    name,
    flags,
    mtpEnabled,
    coldStartMs: null,
    baselineMemoryMb: null,
    loadedMemoryMb: null,
    peakMemoryMb: null,
    releasedMemoryMb: null,
    runs: [],
    medianPredictedPerSecond: 0,
    medianPromptPerSecond: null,
    medianWallMs: 0,
    error: null,
  };

  if (await serverReady(baseUrl(args.port))) {
    result.error = `port ${args.port} already has a llama-server; stop it or pass --port`;
    return result;
  }

  result.baselineMemoryMb = await memoryUsed();
  const logPath = path.join(args.out, `${name}-server.log`);
  const log = createWriteStream(logPath);
  const child = spawn(args.exe, flags, {
    cwd: path.dirname(args.exe),
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(log);
  child.stderr.pipe(log);

  let exitError: string | null = null;
  child.once("exit", (code) => {
    if (code !== null && code !== 0) exitError = `server exited with code ${code}`;
  });

  try {
    try {
      result.coldStartMs = await waitForServer(baseUrl(args.port), START_TIMEOUT_MS);
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      return result;
    }
    result.loadedMemoryMb = await memoryUsed();
    console.log(
      `[${name}] ready in ${result.coldStartMs} ms` +
      (result.loadedMemoryMb !== null ? `, GPU ${result.loadedMemoryMb} MiB` : ""),
    );

    for (let index = 0; index < args.warmup; index += 1) {
      await generate(baseUrl(args.port), prompt, 64);
    }
    for (let index = 1; index <= args.runs; index += 1) {
      const record = await generate(baseUrl(args.port), prompt, args.nPredict);
      record.run = index;
      result.runs.push(record);
      if (record.peakMemoryMb !== null &&
          (result.peakMemoryMb === null || record.peakMemoryMb > result.peakMemoryMb)) {
        result.peakMemoryMb = record.peakMemoryMb;
      }
      console.log(
        `[${name}] run ${index}: ${record.predictedPerSecond.toFixed(1)} t/s, ` +
        `${record.predictedTokens ?? "?"} tokens, ${record.wallMs} ms`,
      );
    }
    result.medianPredictedPerSecond = median(
      result.runs.map((run) => run.predictedPerSecond),
    );
    result.medianPromptPerSecond = median(
      result.runs
        .map((run) => run.promptPerSecond)
        .filter((value): value is number => typeof value === "number"),
    );
    result.medianWallMs = median(result.runs.map((run) => run.wallMs));
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  } finally {
    if (!args.keepServer) {
      await stopServer(child);
      await sleep(1000);
      result.releasedMemoryMb = await memoryUsed();
    }
    log.end();
    if (exitError && !result.error) result.error = exitError;
  }
  return result;
}

async function runAttach(args: Args, prompt: string): Promise<ConfigResult> {
  const result: ConfigResult = {
    name: args.label || "attach",
    flags: [`attach ${args.attach}`],
    mtpEnabled: args.label === "mtp",
    coldStartMs: null,
    baselineMemoryMb: await memoryUsed(),
    loadedMemoryMb: null,
    peakMemoryMb: null,
    releasedMemoryMb: null,
    runs: [],
    medianPredictedPerSecond: 0,
    medianPromptPerSecond: null,
    medianWallMs: 0,
    error: null,
  };
  if (!(await serverReady(args.attach))) {
    result.error = "attach target is not a ready llama-server";
    return result;
  }
  try {
    for (let index = 0; index < args.warmup; index += 1) {
      await generate(args.attach, prompt, 64);
    }
    for (let index = 1; index <= args.runs; index += 1) {
      const record = await generate(args.attach, prompt, args.nPredict);
      record.run = index;
      result.runs.push(record);
      console.log(
        `[${result.name}] run ${index}: ${record.predictedPerSecond.toFixed(1)} t/s`,
      );
    }
    result.medianPredictedPerSecond = median(result.runs.map((run) => run.predictedPerSecond));
    result.medianPromptPerSecond = median(
      result.runs
        .map((run) => run.promptPerSecond)
        .filter((value): value is number => typeof value === "number"),
    );
    result.medianWallMs = median(result.runs.map((run) => run.wallMs));
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }
  return result;
}

function formatMb(value: number | null): string {
  return value === null ? "—" : String(Math.round(value));
}

function renderReport(
  args: Args,
  results: ConfigResult[],
  meta: { head: string; gpu: string },
): string {
  const lines: string[] = [];
  const add = lines.push.bind(lines);
  add("# 本地 LLM MTP 控制复测");
  add("");
  add(`- 时间：${new Date().toISOString()}`);
  add(`- 提交：\`${meta.head}\``);
  add(`- GPU：${meta.gpu}`);
  add(`- 参数：ctx ${args.context} / ngl ${args.gpuLayers} / draft-max ${args.draftMax} / ` +
      `runs ${args.runs} / n-predict ${args.nPredict} / 端口 ${args.port}`);
  if (args.attach) {
    add(`- 模式：attach ${args.attach}（服务端参数未由本脚本控制）`);
  }
  add(`- 提示：${args.promptFile ? `文件 ${args.promptFile}` : "内置固定提示"}`);
  add("");
  add("## 结果");
  add("");
  add("| 配置 | 冷启动 ms | 生成 t/s 中位 | Prompt t/s 中位 | 单次 t/s | 峰值显存 MiB | 加载后 MiB | 相对基线 |");
  add("| --- | ---: | ---: | ---: | --- | ---: | ---: | ---: |");
  const baseline = results.find((item) => item.name === "baseline");
  for (const item of results) {
    const speedup = baseline && baseline.medianPredictedPerSecond > 0
      ? `${(item.medianPredictedPerSecond / baseline.medianPredictedPerSecond).toFixed(2)}×`
      : "—";
    const runs = item.runs.length > 0
      ? item.runs.map((run) => run.predictedPerSecond.toFixed(1)).join(" / ")
      : "—";
    add(
      `| ${item.name} | ${item.coldStartMs ?? "—"} | ${item.medianPredictedPerSecond.toFixed(1)} | ` +
      `${item.medianPromptPerSecond === null ? "—" : item.medianPromptPerSecond.toFixed(1)} | ${runs} | ` +
      `${formatMb(item.peakMemoryMb)} | ${formatMb(item.loadedMemoryMb)} | ${speedup} |`,
    );
  }
  add("");
  add("## 逐次结果");
  add("");
  add("| 配置 | run | 生成 token | 生成 t/s | Prompt token | Prompt t/s | 墙钟 ms | 峰值显存 MiB |");
  add("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const item of results) {
    for (const run of item.runs) {
      add(
        `| ${item.name} | ${run.run} | ${run.predictedTokens ?? "—"} | ` +
        `${run.predictedPerSecond.toFixed(1)} | ${run.promptTokens ?? "—"} | ` +
        `${run.promptPerSecond === null ? "—" : run.promptPerSecond.toFixed(1)} | ${run.wallMs} | ` +
        `${formatMb(run.peakMemoryMb)} |`,
      );
    }
  }
  add("");
  if (results.some((item) => item.error)) {
    add("## 错误");
    add("");
    for (const item of results.filter((entry) => entry.error)) {
      add(`- ${item.name}: ${item.error}`);
    }
    add("");
  }
  add("## 边界");
  add("");
  add("- 每个配置单独启动一个 server 进程，测量结束后由脚本终止；未触碰其他进程。");
  add("- 生成速度优先取 llama.cpp 返回的 `timings.predicted_per_second`，缺失时用墙钟与 completion_tokens 估算。");
  add("- 峰值显存来自 nvidia-smi 250ms 轮询，属于采样值，不是驱动级峰值。");
  if (results.some((item) => item.runs.some((run) => !run.measuredByTimings))) {
    add("- 部分请求没有返回 `timings`，对应 t/s 用墙钟估算，包含提示处理时间，不可与 timing 值直接比较。");
  }
  add("- ComfyUI 或其他 GPU 负载必须提前停止，否则数字只代表共存状态。");
  add("- 同一会话内同一提示会命中 llama.cpp 前缀缓存，Prompt t/s 不代表冷缓存速度；生成 t/s 不受影响。");
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.attach) {
    args.out = args.out || path.join(ROOT, "outputs", `mtp-benchmark-${new Date().toISOString().slice(0, 10)}`);
    await fs.mkdir(args.out, { recursive: true });
    const result = await runAttach(args, args.prompt);
    const gpu = await queryGpu();
    const report = renderReport(args, [result], {
      head: await gitHead(),
      gpu: gpu ? `${gpu.name} (${gpu.totalMb} MiB)` : "nvidia-smi unavailable",
    });
    await fs.writeFile(path.join(args.out, `${args.label || "attach"}.md`), report, "utf8");
    await fs.writeFile(
      path.join(args.out, `${args.label || "attach"}.json`),
      JSON.stringify({ args, results: [result] }, null, 2),
      "utf8",
    );
    console.log(JSON.stringify({
      out: args.out,
      tps: Number(result.medianPredictedPerSecond.toFixed(1)),
      error: result.error,
    }));
    return;
  }

  if (!args.exe || !args.model) {
    throw new Error("--exe and --model are required (or set PROMPTHUB_LLAMA_SERVER / PROMPTHUB_MODEL_PATH)");
  }
  try {
    await fs.access(args.exe);
    await fs.access(args.model);
  } catch {
    throw new Error("executable or model file does not exist");
  }
  if (args.promptFile) {
    args.prompt = (await fs.readFile(args.promptFile, "utf8")).trim();
    if (!args.prompt) throw new Error("prompt file is empty");
  }
  args.out = args.out || path.join(ROOT, "outputs", `mtp-benchmark-${new Date().toISOString().slice(0, 10)}`);
  await fs.mkdir(args.out, { recursive: true });

  const results: ConfigResult[] = [];
  for (const name of args.configs) {
    if (name !== "baseline" && name !== "mtp") {
      throw new Error(`unknown config ${name}; use baseline and/or mtp`);
    }
    results.push(await runConfig(args, name, args.prompt));
  }

  const gpu = await queryGpu();
  const report = renderReport(args, results, {
    head: await gitHead(),
    gpu: gpu ? `${gpu.name} (${gpu.totalMb} MiB)` : "nvidia-smi unavailable",
  });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await fs.writeFile(path.join(args.out, `report-${stamp}.md`), report, "utf8");
  await fs.writeFile(
    path.join(args.out, `report-${stamp}.json`),
    JSON.stringify({ args, results, gpu }, null, 2),
    "utf8",
  );
  console.log(JSON.stringify({
    out: args.out,
    results: results.map((item) => ({
      name: item.name,
      mtp: item.mtpEnabled,
      tps: Number(item.medianPredictedPerSecond.toFixed(1)),
      error: item.error,
    })),
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
