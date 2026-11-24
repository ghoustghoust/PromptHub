import {
  DEFAULT_LOCAL_LLAMA_CONFIG,
  LOCAL_CONTEXT_PRESETS,
  type LocalLlamaEngineConfig,
  type LocalLlamaKvCacheType,
  type LocalLlamaModelProfile,
} from "@prompthub/shared/types";

const LOCAL_MODEL_ALIAS = "prompthub-local";

/** Leave room for the desktop, driver bookkeeping and CUDA context growth. */
export const LOCAL_LLAMA_VRAM_SAFETY_MB = 64;

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

function readUrl(value: unknown, fallback: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || value.includes("\0")) {
    throw new Error("ComfyUI URL must be a valid string");
  }
  const url = value.trim();
  if (!url) return "";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("ComfyUI URL must be an absolute http(s) URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("ComfyUI URL must be an absolute http(s) URL");
  }
  return parsed.toString();
}

function readProfiles(value: unknown): LocalLlamaModelProfile[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) {
    throw new Error("Model profiles must be an array of at most 20 items");
  }
  return value.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`Model profile ${index} must be an object`);
    const id = readPath(entry.id);
    const name = readPath(entry.name);
    if (!id || !name) throw new Error(`Model profile ${index} needs an id and a name`);
    const modelPath = readPath(entry.modelPath);
    if (!modelPath) throw new Error(`Model profile ${index} needs a model path`);
    return {
      id,
      name,
      modelPath,
      mmprojPath: readPath(entry.mmprojPath),
      contextSize: readInteger(entry.contextSize, 8192, "Profile context size", 512, 262144),
      gpuLayers: readInteger(entry.gpuLayers, 99, "Profile GPU layers", -1, 999),
      mtpEnabled: readBoolean(entry.mtpEnabled, false),
      mtpDraftMax: readInteger(entry.mtpDraftMax, 2, "Profile MTP draft tokens", 1, 8),
    };
  });
}

/**
 * Conservative engine-side VRAM estimate in MiB. It intentionally excludes the
 * desktop baseline, because the caller compares it with free memory after an
 * unload. Context presets are measured values; larger custom contexts grow
 * linearly from the 64K point.
 */
export function estimateLocalLlamaVramMb(
  config: Pick<
    LocalLlamaEngineConfig,
    "contextSize" | "mmprojPath" | "parallel"
  >,
): number {
  const contextSize = config.contextSize;
  let baseMb: number;
  if (contextSize >= 131072) {
    baseMb = 6400 + (contextSize - 65536) * 0.012;
  } else if (contextSize >= 65536) {
    baseMb = 6400;
  } else if (contextSize >= 32768) {
    baseMb = 6150;
  } else {
    baseMb = 6300 + Math.max(0, contextSize - 8192) * 0.01;
  }
  const visionMb = config.mmprojPath ? 350 : 0;
  const parallelMb = Math.max(0, config.parallel - 1) * 512;
  return Math.round(baseMb + visionMb + parallelMb);
}

export function normalizeLocalLlamaConfig(
  value: unknown,
): LocalLlamaEngineConfig {
  if (!isRecord(value)) throw new Error("Local engine config must be an object");
  const defaults = DEFAULT_LOCAL_LLAMA_CONFIG;
  const requestedKvCacheType = value.kvCacheType ?? defaults.kvCacheType;
  if (
    !(["f16", "q8_0", "q4_0"] as const).includes(
      requestedKvCacheType as LocalLlamaKvCacheType,
    )
  ) {
    throw new Error("Unsupported KV cache type");
  }
  const contextSize = readInteger(
    value.contextSize,
    defaults.contextSize,
    "Context size",
    512,
    262144,
  );
  // Above 8K the measured cost is dominated by KV placement, so large contexts
  // are a fixed policy: q4 KV in host memory. Keeping this in normalization
  // prevents manual inputs and old profiles from bypassing the safe preset.
  const largeContext = contextSize >= LOCAL_CONTEXT_PRESETS["32k"].contextSize;
  const kvCacheType = largeContext
    ? LOCAL_CONTEXT_PRESETS["32k"].kvCacheType
    : (requestedKvCacheType as LocalLlamaKvCacheType);
  return {
    executablePath: readPath(value.executablePath),
    modelPath: readPath(value.modelPath),
    mmprojPath: readPath(value.mmprojPath),
    port: readInteger(value.port, defaults.port, "Port", 1024, 65535),
    contextSize,
    gpuLayers: readInteger(value.gpuLayers, defaults.gpuLayers, "GPU layers", -1, 999),
    parallel: readInteger(value.parallel, defaults.parallel, "Parallel slots", 1, 16),
    flashAttention: readBoolean(value.flashAttention, defaults.flashAttention),
    kvCacheType,
    kvOffload: largeContext
      ? false
      : readBoolean(value.kvOffload, defaults.kvOffload),
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
    idleUnloadMinutes: readInteger(
      value.idleUnloadMinutes,
      defaults.idleUnloadMinutes,
      "Idle unload minutes",
      0,
      240,
    ),
    modelProfiles: readProfiles(value.modelProfiles),
    comfyUrl: readUrl(value.comfyUrl, defaults.comfyUrl),
  };
}

/**
 * Builds the llama-server arguments the desktop app actually uses. Kept pure so
 * the MTP benchmark harness measures the same flag set as production.
 */
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
    config.kvOffload ? "--kv-offload" : "--no-kv-offload",
    "--no-webui",
    // Tool calling and the model-native chat template require the Jinja path;
    // without it llama.cpp ignores the tools payload and the orchestrator has to
    // fall back after a wasted request.
    "--jinja",
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

export { DEFAULT_LOCAL_LLAMA_CONFIG } from "@prompthub/shared/types";

