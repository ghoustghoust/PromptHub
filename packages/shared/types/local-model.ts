export type LocalLlamaKvCacheType = "f16" | "q8_0" | "q4_0";

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
  /** Unified KV buffer across slots; llama.cpp turns it off when --parallel is pinned to 1. */
  kvUnified: boolean;
  mtpEnabled: boolean;
  mtpDraftMax: number;
  imageMaxTokens: number;
  /** Release the engine after this many idle minutes; 0 keeps it resident. */
  idleUnloadMinutes: number;
}

export type LocalLlamaEnginePhase =
  | "stopped"
  | "starting"
  | "running"
  | "stopping"
  | "error";

export interface LocalLlamaEngineStatus {
  phase: LocalLlamaEnginePhase;
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
  kvUnified: true,
  mtpEnabled: false,
  mtpDraftMax: 2,
  imageMaxTokens: 2048,
  idleUnloadMinutes: 0,
};

export function localLlamaEndpoint(port: number): string {
  return `http://127.0.0.1:${port}/v1`;
}
