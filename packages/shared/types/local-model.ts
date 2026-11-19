export type LocalLlamaKvCacheType = "f16" | "q8_0" | "q4_0";

export interface LocalLlamaEngineConfig {
  executablePath: string;
  modelPath: string;
  mmprojPath: string;
  port: number;
  contextSize: number;
  gpuLayers: number;
  parallel: number;
  flashAttention: boolean;
  kvCacheType: LocalLlamaKvCacheType;
  mtpEnabled: boolean;
  mtpDraftMax: number;
  imageMaxTokens: number;
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
  message: string;
  updatedAt: string;
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
  mtpEnabled: false,
  mtpDraftMax: 2,
  imageMaxTokens: 2048,
};

export function localLlamaEndpoint(port: number): string {
  return `http://127.0.0.1:${port}/v1`;
}
