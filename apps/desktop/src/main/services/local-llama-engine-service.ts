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
  type LocalLlamaUnloadResult,
} from "@prompthub/shared/types";
import { getUserDataPath } from "../runtime-paths";
import { buildLocalLlamaArgs, normalizeLocalLlamaConfig } from "./local-llama-args";

export { buildLocalLlamaArgs, normalizeLocalLlamaConfig };

const START_TIMEOUT_MS = 120_000;
const STOP_TIMEOUT_MS = 8_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

/** Used/total GPU memory in MiB, or null when nvidia-smi is unavailable. */
function readGpuUsage(): Promise<{ usedMb: number; totalMb: number } | null> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(
        "nvidia-smi",
        ["--query-gpu=memory.used,memory.total", "--format=csv,noheader,nounits"],
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
      const [used, total] = buffer.split(/\r?\n/)[0]?.split(",").map((part) => Number(part.trim())) ?? [];
      resolve(
        Number.isFinite(used) && Number.isFinite(total) && total > 0
          ? { usedMb: used, totalMb: total }
          : null,
      );
    });
  });
}

/** Runs a short Windows helper and returns its text output; never throws. */
function runCommand(
  command: string,
  args: string[],
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      resolve({ code: null, output: "" });
      return;
    }
    let output = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve({ code: null, output });
    }, 6000);
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ code: null, output });
    });
    child.on("exit", (code: number | null) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

/** PID of the process LISTENING on the port, or null when nothing listens. */
async function findListeningPid(port: number): Promise<number | null> {
  const { output } = await runCommand("netstat", ["-ano", "-p", "tcp"]);
  for (const line of output.split(/\r?\n/)) {
    const match = line
      .trim()
      .match(/^TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)$/i);
    if (match && Number(match[1]) === port) return Number(match[2]);
  }
  return null;
}

async function processImageName(pid: number): Promise<string> {
  const { output } = await runCommand("tasklist", [
    "/FI",
    `PID eq ${pid}`,
    "/FO",
    "CSV",
    "/NH",
  ]);
  return output.trim().split(",")[0]?.replace(/^"|"$/g, "") ?? "";
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
  private idleTimer: NodeJS.Timeout | null = null;
  private lastActivityAt = Date.now();

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

  /** Called whenever PromptHub sends a request to the local model. */
  noteActivity(): void {
    this.lastActivityAt = Date.now();
  }

  private stopIdleMonitor(): void {
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private startIdleMonitor(config: LocalLlamaEngineConfig): void {
    this.stopIdleMonitor();
    this.lastActivityAt = Date.now();
    if (config.idleUnloadMinutes <= 0) return;
    this.idleTimer = setInterval(() => {
      void this.checkIdle(config);
    }, 30_000);
    this.idleTimer.unref?.();
  }

  /** true = a slot is processing, false = idle, null = endpoint unsupported. */
  private async slotActivity(port: number): Promise<boolean | null> {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/slots`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(1500),
      });
      if (!response.ok) return null;
      const payload: unknown = await response.json();
      if (!Array.isArray(payload)) return null;
      return payload.some(
        (slot) => isRecord(slot) && (slot.is_processing === true || slot.state === 1),
      );
    } catch {
      return null;
    }
  }

  private async checkIdle(config: LocalLlamaEngineConfig): Promise<void> {
    if (this.phase !== "running" || !this.child) return;
    const active = await this.slotActivity(config.port);
    // Without /slots there is no safe activity signal; leave the engine alone
    // rather than risk releasing it during an active chat.
    if (active === null) return;
    if (active) {
      this.lastActivityAt = Date.now();
      return;
    }
    const idleMs = config.idleUnloadMinutes * 60_000;
    if (Date.now() - this.lastActivityAt < idleMs) return;
    const minutes = config.idleUnloadMinutes;
    try {
      await this.unload();
      this.message = `Released the local engine after ${minutes} minutes without requests.`;
    } catch {
      // Keep the engine alive if the unload could not be verified.
    }
  }

  /** Hard preflight: starting into occupied VRAM usually ends in a CPU fallback or OOM. */
  private async checkVram(config: LocalLlamaEngineConfig): Promise<string | null> {
    const usage = await readGpuUsage();
    if (!usage) return null;
    let modelMb = 0;
    try {
      const stat = await fs.stat(config.modelPath);
      modelMb = stat.size / (1024 * 1024);
    } catch {
      return null;
    }
    if (modelMb <= 0) return null;
    // Coarse guard: only refuse when the GPU is already heavily occupied by
    // something else (ComfyUI and friends). A tight model-size estimate would
    // reject configurations that llama.cpp can still fit with mmap sharing.
    const required = Math.max(
      1536,
      Math.min(4096, Math.round(usage.totalMb * 0.6)),
      Math.round(modelMb * 0.55),
    );
    const free = usage.totalMb - usage.usedMb;
    if (free >= required) return null;
    return (
      `Not enough free VRAM: ${Math.round(free)} MiB free, about ${required} MiB needed. ` +
      "Close ComfyUI or lower GPU layers, then start again."
    );
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

    const vramProblem = await this.checkVram(config);
    if (vramProblem) {
      this.phase = "error";
      this.managed = false;
      this.message = vramProblem;
      throw new Error(vramProblem);
    }

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
      this.stopIdleMonitor();
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
          this.startIdleMonitor(config);
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
    this.stopIdleMonitor();
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

  /**
   * Manual unload: ends the engine and waits for the port/VRAM to come back.
   * Stopping the request queue is not enough — llama-server keeps the weights
   * resident, so only terminating the process returns VRAM and RAM.
   */
  async unload(): Promise<LocalLlamaUnloadResult> {
    const config = await this.readConfig();
    const before = await readGpuUsedMb();
    if (this.startPromise) await this.startPromise.catch(() => undefined);
    let stoppedExternal = false;

    if (this.child) {
      await this.stop();
    } else {
      stoppedExternal = await this.terminateExternal(config);
    }

    // The driver needs a moment to hand the allocation back before it can be read.
    await delay(800);
    const after = await readGpuUsedMb();
    const status = await this.getStatus();
    if (status.phase === "running") {
      throw new Error(
        `The local engine still responds at ${status.endpoint} after unload`,
      );
    }
    return {
      status,
      freedGpuMb:
        before !== null && after !== null ? Math.max(0, before - after) : null,
      stoppedExternal,
    };
  }

  /** Ends an engine PromptHub did not start, but only when the port belongs to llama. */
  private async terminateExternal(
    config: LocalLlamaEngineConfig,
  ): Promise<boolean> {
    const status = await this.getStatus();
    if (status.phase !== "running") return false;
    const pid = await findListeningPid(config.port);
    if (!pid) {
      throw new Error(
        `The local engine responds on port ${config.port}, but its process could not be resolved`,
      );
    }
    const name = await processImageName(pid);
    if (!/llama/i.test(name)) {
      throw new Error(
        `Port ${config.port} is held by ${name || "an unknown process"}; PromptHub only ends llama processes`,
      );
    }
    await runCommand("taskkill", ["/PID", String(pid), "/T", "/F"]);
    this.phase = "stopped";
    this.managed = false;
    this.models = [];
    this.message = "";
    this.onGpu = null;
    this.gpuUsedMb = null;
    const deadline = Date.now() + STOP_TIMEOUT_MS;
    let released = false;
    while (Date.now() < deadline) {
      try {
        await this.probe(config);
        await delay(400);
      } catch {
        released = true;
        break;
      }
    }
    if (!released) {
      throw new Error(
        `Process ${pid} did not release port ${config.port}; it may need administrator rights`,
      );
    }
    return true;
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
