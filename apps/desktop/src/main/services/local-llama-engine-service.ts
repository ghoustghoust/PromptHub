import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createWriteStream, type WriteStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_LOCAL_LLAMA_CONFIG,
  localLlamaEndpoint,
  type LocalLlamaEngineConfig,
  type LocalLlamaEnginePhase,
  type LocalLlamaEngineStatus,
  type LocalLlamaKvCacheType,
} from "@prompthub/shared/types";
import { getUserDataPath } from "../runtime-paths";

const START_TIMEOUT_MS = 120_000;
const STOP_TIMEOUT_MS = 8_000;
const LOCAL_MODEL_ALIAS = "prompthub-local";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readPath(value: unknown, fallback = ""): string {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || value.includes("\0")) {
    throw new Error("Local model paths must be valid strings");
  }
  return value.trim();
}

function readInteger(
  value: unknown,
  fallback: number,
  name: string,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined) return fallback;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new Error("Invalid local engine toggle");
  return value;
}

export function normalizeLocalLlamaConfig(
  value: unknown,
): LocalLlamaEngineConfig {
  if (!isRecord(value)) throw new Error("Local engine config must be an object");
  const defaults = DEFAULT_LOCAL_LLAMA_CONFIG;
  const kvCacheType = value.kvCacheType ?? defaults.kvCacheType;
  if (!(["f16", "q8_0", "q4_0"] as const).includes(kvCacheType as LocalLlamaKvCacheType)) {
    throw new Error("Unsupported KV cache type");
  }
  return {
    executablePath: readPath(value.executablePath),
    modelPath: readPath(value.modelPath),
    mmprojPath: readPath(value.mmprojPath),
    port: readInteger(value.port, defaults.port, "Port", 1024, 65535),
    contextSize: readInteger(
      value.contextSize,
      defaults.contextSize,
      "Context size",
      512,
      262144,
    ),
    gpuLayers: readInteger(value.gpuLayers, defaults.gpuLayers, "GPU layers", -1, 999),
    parallel: readInteger(value.parallel, defaults.parallel, "Parallel slots", 1, 16),
    flashAttention: readBoolean(value.flashAttention, defaults.flashAttention),
    kvCacheType: kvCacheType as LocalLlamaKvCacheType,
    kvUnified: readBoolean(value.kvUnified, defaults.kvUnified),
    mtpEnabled: readBoolean(value.mtpEnabled, defaults.mtpEnabled),
    mtpDraftMax: readInteger(
      value.mtpDraftMax,
      defaults.mtpDraftMax,
      "MTP draft tokens",
      1,
      8,
    ),
    imageMaxTokens: readInteger(
      value.imageMaxTokens,
      defaults.imageMaxTokens,
      "Image token budget",
      128,
      8192,
    ),
  };
}

export function buildLocalLlamaArgs(config: LocalLlamaEngineConfig): string[] {
  const args = [
    "--host", "127.0.0.1",
    "--port", String(config.port),
    "--model", config.modelPath,
    "--alias", LOCAL_MODEL_ALIAS,
    "--ctx-size", String(config.contextSize),
    ...(config.gpuLayers >= 0 ? ["--n-gpu-layers", String(config.gpuLayers)] : []),
    "--parallel", String(config.parallel),
    "--flash-attn", config.flashAttention ? "on" : "off",
    "--cache-type-k", config.kvCacheType,
    "--cache-type-v", config.kvCacheType,
    "--no-webui",
  ];
  if (config.mmprojPath) {
    args.push(
      "--mmproj", config.mmprojPath,
      "--image-max-tokens", String(config.imageMaxTokens),
    );
  }
  // --parallel 1 makes llama.cpp drop the unified KV buffer unless it is requested explicitly.
  if (config.kvUnified) args.push("--kv-unified");
  if (config.mtpEnabled) {
    args.push(
      "--spec-type", "draft-mtp",
      "--spec-draft-n-max", String(config.mtpDraftMax),
    );
  }
  return args;
}

async function assertRegularFile(filePath: string, label: string): Promise<void> {
  if (!filePath) throw new Error(`${label} is required`);
  let stats;
  try {
    stats = await fs.stat(filePath);
  } catch {
    throw new Error(`${label} was not found: ${filePath}`);
  }
  if (!stats.isFile()) throw new Error(`${label} is not a file: ${filePath}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** Total GPU memory in use across the machine, or null when it cannot be read. */
function readGpuUsedMb(): Promise<number | null> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(
        "nvidia-smi",
        ["--query-gpu=memory.used", "--format=csv,noheader,nounits"],
        { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] },
      );
    } catch {
      resolve(null);
      return;
    }
    let buffer = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve(null);
    }, 4000);
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on("exit", () => {
      clearTimeout(timer);
      const value = Number(buffer.split(/\r?\n/)[0]?.trim());
      resolve(Number.isFinite(value) ? value : null);
    });
  });
}

export class LocalLlamaEngineService {
  private child: ChildProcessWithoutNullStreams | null = null;
  private phase: LocalLlamaEnginePhase = "stopped";
  private managed = false;
  private models: string[] = [];
  private message = "";
  private recentOutput = "";
  private onGpu: boolean | null = null;
  private gpuUsedMb: number | null = null;
  private logStream: WriteStream | null = null;
  private startPromise: Promise<LocalLlamaEngineStatus> | null = null;
  private stopPromise: Promise<LocalLlamaEngineStatus> | null = null;

  constructor(private readonly rootPath?: string) {}

  private root(): string {
    return this.rootPath ?? getUserDataPath();
  }

  private configPath(): string {
    return path.join(this.root(), "config", "local-llama.json");
  }

  private logPath(): string {
    return path.join(this.root(), "logs", "local-llama-engine.log");
  }

  async readConfig(): Promise<LocalLlamaEngineConfig> {
    try {
      const raw = await fs.readFile(this.configPath(), "utf8");
      return normalizeLocalLlamaConfig(JSON.parse(raw));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { ...DEFAULT_LOCAL_LLAMA_CONFIG };
      }
      throw new Error(`Unable to read local engine config: ${errorMessage(error)}`);
    }
  }

  async saveConfig(value: unknown): Promise<LocalLlamaEngineConfig> {
    if (this.child) throw new Error("Stop the managed engine before changing its settings");
    const config = normalizeLocalLlamaConfig(value);
    const filePath = this.configPath();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.tmp-${process.pid}`;
    await fs.writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    await fs.rename(temporary, filePath);
    return config;
  }

  private snapshot(config: LocalLlamaEngineConfig): LocalLlamaEngineStatus {
    return {
      phase: this.phase,
      managed: this.managed,
      pid: this.child?.pid ?? null,
      endpoint: localLlamaEndpoint(config.port),
      models: [...this.models],
      vision: Boolean(config.mmprojPath),
      onGpu: this.onGpu,
      gpuUsedMb: this.gpuUsedMb,
      message: this.message,
      updatedAt: new Date().toISOString(),
    };
  }

  private async probe(config: LocalLlamaEngineConfig): Promise<string[]> {
    const response = await fetch(`${localLlamaEndpoint(config.port)}/models`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) throw new Error(`Model endpoint returned HTTP ${response.status}`);
    const payload = (await response.json()) as { data?: unknown };
    if (!Array.isArray(payload.data)) throw new Error("Invalid /v1/models response");
    const models = payload.data.flatMap((entry) =>
      isRecord(entry) && typeof entry.id === "string" && entry.id.trim()
        ? [entry.id.trim()]
        : [],
    );
    if (models.length === 0) throw new Error("The local endpoint reported no models");
    return [...new Set(models)];
  }

  async getStatus(): Promise<LocalLlamaEngineStatus> {
    const config = await this.readConfig();
    if (this.child && (this.phase === "starting" || this.phase === "stopping")) {
      return this.snapshot(config);
    }
    try {
      const models = await this.probe(config);
      this.models = models;
      this.phase = "running";
      this.managed = this.child !== null;
      this.message = "";
    } catch (error) {
      if (this.child) {
        this.phase = "error";
        this.managed = true;
        this.message = `Managed engine is not responding: ${errorMessage(error)}`;
      } else {
        this.phase = "stopped";
        this.managed = false;
        this.models = [];
        this.message = "";
      }
    }
    return this.snapshot(config);
  }

  async start(): Promise<LocalLlamaEngineStatus> {
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.startInternal().finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  private async startInternal(): Promise<LocalLlamaEngineStatus> {
    const config = await this.readConfig();
    if (!this.child) {
      try {
        const models = await this.probe(config);
        this.models = models;
        this.phase = "running";
        this.managed = false;
        this.message = "";
        return this.snapshot(config);
      } catch {
        // No compatible server is already listening; start the configured engine.
      }
    } else if (this.phase === "running") {
      return this.getStatus();
    } else if (this.child) {
      await this.terminate(this.child);
      this.child = null;
    }

    await assertRegularFile(config.executablePath, "llama-server executable");
    await assertRegularFile(config.modelPath, "GGUF model");
    if (config.mmprojPath) await assertRegularFile(config.mmprojPath, "mmproj projector");

    this.phase = "starting";
    this.managed = true;
    this.message = "Loading the local model";
    this.models = [];
    this.recentOutput = "";
    await fs.mkdir(path.dirname(this.logPath()), { recursive: true });
    this.openLogStream();
    const gpuBefore = await readGpuUsedMb();

    const child = spawn(config.executablePath, buildLocalLlamaArgs(config), {
      cwd: path.dirname(config.executablePath),
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    // Model loading is CPU/disk heavy on a single desktop; keep the UI responsive.
    try {
      if (child.pid) {
        os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
      }
    } catch {
      // Priority is advisory only.
    }
    let startupFailure = "";
    const appendOutput = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      // Keep only the tail in memory. Writing every chunk with fs.appendFile
      // queues thousands of open/write/close operations and blocks the main process.
      this.recentOutput = `${this.recentOutput}${text}`.slice(-6000);
      this.logStream?.write(text);
    };
    child.stdout.on("data", appendOutput);
    child.stderr.on("data", appendOutput);
    child.on("error", (error) => {
      startupFailure = errorMessage(error);
      this.message = startupFailure;
      this.phase = "error";
    });
    child.on("exit", (code, signal) => {
      this.closeLogStream();
      startupFailure ||= `llama-server exited (${code ?? signal ?? "unknown"})`;
      if (this.child === child) this.child = null;
      if (this.phase !== "stopping" && this.phase !== "error") {
        this.phase = code === 0 ? "stopped" : "error";
        this.message = code === 0 ? "" : `llama-server exited (${code ?? signal ?? "unknown"})`;
      }
      if (this.phase === "stopping") {
        this.phase = "stopped";
        this.managed = false;
        this.models = [];
        this.message = "";
      }
    });

    try {
      const deadline = Date.now() + START_TIMEOUT_MS;
      while (Date.now() < deadline) {
        if (this.child !== child || startupFailure) {
          const tail = this.recentOutput.slice(-1200).trim();
          throw new Error(tail ? `${startupFailure || "llama-server exited"}\n${tail}` : (startupFailure || "llama-server exited"));
        }
        try {
          this.models = await this.probe(config);
          this.phase = "running";
          this.managed = true;
          this.message = "";
          const gpuAfter = await readGpuUsedMb();
          this.gpuUsedMb = gpuAfter;
          this.onGpu =
            gpuBefore !== null && gpuAfter !== null ? gpuAfter - gpuBefore >= 1024 : null;
          return this.snapshot(config);
        } catch {
          await delay(500);
        }
      }
      throw new Error(`Timed out waiting for llama-server. ${this.recentOutput.slice(-1200)}`);
    } catch (error) {
      this.phase = "error";
      this.managed = true;
      this.message = errorMessage(error);
      this.onGpu = null;
      this.gpuUsedMb = null;
      this.closeLogStream();
      await this.terminate(child);
      throw new Error(this.message);
    }
  }

  async stop(): Promise<LocalLlamaEngineStatus> {
    if (this.stopPromise) return this.stopPromise;
    this.stopPromise = this.stopInternal().finally(() => {
      this.stopPromise = null;
    });
    return this.stopPromise;
  }

  private async stopInternal(): Promise<LocalLlamaEngineStatus> {
    if (this.startPromise) await this.startPromise.catch(() => undefined);
    const config = await this.readConfig();
    const child = this.child;
    if (!child) {
      const status = await this.getStatus();
      if (status.phase === "running" && !status.managed) {
        throw new Error("The running engine was started externally and will not be stopped by PromptHub");
      }
      return status;
    }
    this.phase = "stopping";
    this.message = "Stopping the managed engine";
    await this.terminate(child);
    this.child = null;
    this.phase = "stopped";
    this.managed = false;
    this.models = [];
    this.message = "";
    this.onGpu = null;
    this.gpuUsedMb = null;
    this.closeLogStream();
    return this.snapshot(config);
  }

  async restart(): Promise<LocalLlamaEngineStatus> {
    await this.stop();
    return this.start();
  }

  private openLogStream(): void {
    this.closeLogStream();
    try {
      this.logStream = createWriteStream(this.logPath(), { flags: "a" });
      this.logStream.on("error", () => {
        this.logStream = null;
      });
    } catch {
      this.logStream = null;
    }
  }

  private closeLogStream(): void {
    const stream = this.logStream;
    this.logStream = null;
    stream?.end();
  }

  private async terminate(child: ChildProcessWithoutNullStreams): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    child.kill();
    await Promise.race([exited, delay(STOP_TIMEOUT_MS)]);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await Promise.race([exited, delay(2000)]);
    }
  }

  shutdown(): void {
    this.closeLogStream();
    if (this.child && this.child.exitCode === null && this.child.signalCode === null) {
      this.child.kill();
    }
  }

  async readLog(): Promise<string> {
    try {
      const raw = await fs.readFile(this.logPath(), "utf8");
      return raw.slice(-64_000);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw error;
    }
  }
}
