export type LocalLlamaKvCacheType = "f16" | "q8_0" | "q4_0";

/** Saved model preset: paths plus the parameters that depend on the model. */
export interface LocalLlamaModelProfile {
  id: string;
  name: string;
  modelPath: string;
  mmprojPath: string;
  contextSize: number;
  gpuLayers: number;
  mtpEnabled: boolean;
  mtpDraftMax: number;
}

export interface LocalLlamaEngineConfig {
  executablePath: string;
  modelPath: string;
  mmprojPath: string;
  port: number;
  contextSize: number;
  /** -1 lets llama.cpp fit the layers to free VRAM and keep headroom for the desktop. */
  gpuLayers: number;
  parallel: number;
  flashAttention: boolean;
  kvCacheType: LocalLlamaKvCacheType;
  /** Keep the KV cache in host memory (`--no-kv-offload`) to trade speed for context size. */
  kvOffload: boolean;
  /** Unified KV buffer across slots; llama.cpp turns it off when --parallel is pinned to 1. */
  kvUnified: boolean;
  mtpEnabled: boolean;
  mtpDraftMax: number;
  imageMaxTokens: number;
  /** Release the engine after this many idle minutes; 0 keeps it resident. */
  idleUnloadMinutes: number;
  /** Saved model presets shown in Settings. */
  modelProfiles: LocalLlamaModelProfile[];
  /** Address opened by the "release and open ComfyUI" action. */
  comfyUrl: string;
}

export type LocalLlamaEnginePhase =
  | "stopped"
  | "starting"
  | "running"
  | "stopping"
  | "error";

/** Sub-stage while `phase` is `starting`; weights loading is the long one. */
export type LocalLlamaStartStage =
  | "idle"
  | "spawn"
  | "load-weights"
  | "health-check";

export interface LocalLlamaEventLoopDelay {
  p50: number;
  p95: number;
  max: number;
}

export interface LocalLlamaEngineStatus {
  phase: LocalLlamaEnginePhase;
  /** Present while starting; `idle` otherwise. */
  stage?: LocalLlamaStartStage;
  /** Measured during the last start so blocking can be diagnosed, not guessed. */
  eventLoopDelayMs?: LocalLlamaEventLoopDelay | null;
  managed: boolean;
  pid: number | null;
  endpoint: string;
  models: string[];
  vision: boolean;
  /** false means the model stayed on CPU, which costs an order of magnitude in speed. */
  onGpu: boolean | null;
  /** Total GPU memory in use when the engine became ready; null when unavailable. */
  gpuUsedMb: number | null;
  message: string;
  updatedAt: string;
}

export interface LocalLlamaUnloadResult {
  status: LocalLlamaEngineStatus;
  /** GPU memory the driver reported back after the engine exited; null when unreadable. */
  freedGpuMb: number | null;
  /** True when the engine was started outside PromptHub and had to be terminated by port. */
  stoppedExternal: boolean;
}

export type LocalLlamaContextPreset = "8k" | "32k" | "64k";

/**
 * Large contexts keep the KV cache in host memory. On an 8 GB card a GPU-side
 * 32K KV cache competes with the weights and MTP buffers; q4 host KV measured
 * roughly 30 t/s versus 80 t/s for 8K GPU KV, which is the documented tradeoff.
 */
export const LOCAL_CONTEXT_PRESETS: Record<
  LocalLlamaContextPreset,
  { contextSize: number; kvCacheType: LocalLlamaKvCacheType; kvOffload: boolean }
> = {
  "8k": { contextSize: 8192, kvCacheType: "q8_0", kvOffload: true },
  "32k": { contextSize: 32768, kvCacheType: "q4_0", kvOffload: false },
  "64k": { contextSize: 65536, kvCacheType: "q4_0", kvOffload: false },
};

export function localContextPresetOf(
  value: Pick<LocalLlamaEngineConfig, "contextSize" | "kvCacheType" | "kvOffload">,
): LocalLlamaContextPreset | "custom" {
  for (const preset of Object.keys(LOCAL_CONTEXT_PRESETS) as LocalLlamaContextPreset[]) {
    const spec = LOCAL_CONTEXT_PRESETS[preset];
    if (
      value.contextSize === spec.contextSize &&
      value.kvCacheType === spec.kvCacheType &&
      value.kvOffload === spec.kvOffload
    ) {
      return preset;
    }
  }
  return "custom";
}

export interface LocalLlamaContextSwitchResult {
  status: LocalLlamaEngineStatus;
  preset: LocalLlamaContextPreset;
  previousPreset: LocalLlamaContextPreset | "custom";
  /** Estimated engine-side VRAM need in MiB, excluding the desktop baseline. */
  estimateMb: number | null;
  /** Free VRAM measured after the old engine was unloaded. */
  freeMb: number | null;
  /** True only when the target failed and the previous profile came back. */
  rolledBack: boolean;
}

export interface LocalLlamaModelConnection {
  apiUrl: string;
  model: string;
  name: string;
  vision: boolean;
  verifiedAt: string;
}

export const DEFAULT_LOCAL_LLAMA_CONFIG: LocalLlamaEngineConfig = {
  executablePath: "",
  modelPath: "",
  mmprojPath: "",
  port: 8080,
  contextSize: 8192,
  gpuLayers: 99,
  parallel: 1,
  flashAttention: true,
  kvCacheType: "q8_0",
  kvOffload: true,
  kvUnified: true,
  mtpEnabled: false,
  mtpDraftMax: 2,
  imageMaxTokens: 2048,
  idleUnloadMinutes: 0,
  modelProfiles: [],
  comfyUrl: "http://127.0.0.1:8288",
};

export function localLlamaEndpoint(port: number): string {
  return `http://127.0.0.1:${port}/v1`;
}
