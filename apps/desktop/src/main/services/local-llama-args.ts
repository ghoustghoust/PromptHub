import {
  DEFAULT_LOCAL_LLAMA_CONFIG,
  type LocalLlamaEngineConfig,
  type LocalLlamaKvCacheType,
  type LocalLlamaModelProfile,
} from "@prompthub/shared/types";

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
