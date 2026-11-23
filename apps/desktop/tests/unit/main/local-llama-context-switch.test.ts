import { describe, expect, it, vi } from "vitest";
import { DEFAULT_LOCAL_LLAMA_CONFIG, type LocalLlamaEngineStatus } from "@prompthub/shared/types";
import { LocalLlamaEngineService } from "../../../src/main/services/local-llama-engine-service";

const running: LocalLlamaEngineStatus = {
  phase: "running",
  managed: true,
  pid: 1234,
  endpoint: "http://127.0.0.1:8080/v1",
  models: ["prompthub-local"],
  vision: false,
  onGpu: true,
  gpuUsedMb: 7000,
  message: "",
  updatedAt: new Date().toISOString(),
};

describe("local llama context switch", () => {
  it("restores the previous profile when the target engine fails to start", async () => {
    const service = new LocalLlamaEngineService(process.cwd());
    const previous = {
      ...DEFAULT_LOCAL_LLAMA_CONFIG,
      executablePath: "D:\\tools\\llama.cpp\\llama-server.exe",
      modelPath: "G:\\models\\text.gguf",
    };
    const saveConfig = vi.fn(async (value: unknown) => value);
    const start = vi
      .fn()
      .mockRejectedValueOnce(new Error("CUDA out of memory"))
      .mockResolvedValueOnce({ ...running, managed: true });

    (service as any).readConfig = vi.fn(async () => previous);
    (service as any).getStatus = vi.fn(async () => running);
    (service as any).unload = vi.fn(async () => ({ status: { ...running, phase: "stopped" } }));
    (service as any).saveConfig = saveConfig;
    (service as any).start = start;

    await expect((service as any).switchContextPreset("32k", true)).rejects.toThrow(
      /Rolled back to 8k/,
    );

    expect(saveConfig).toHaveBeenCalledTimes(2);
    expect(saveConfig.mock.calls[0][0]).toMatchObject({
      contextSize: 32768,
      kvCacheType: "q4_0",
      kvOffload: false,
    });
    expect(saveConfig.mock.calls[1][0]).toMatchObject({
      contextSize: 8192,
      kvCacheType: "q8_0",
      kvOffload: true,
    });
    expect(start).toHaveBeenCalledTimes(2);
  });
});
