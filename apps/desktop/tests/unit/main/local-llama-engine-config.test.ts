import { describe, expect, it } from "vitest";
import { DEFAULT_LOCAL_LLAMA_CONFIG } from "@prompthub/shared/types";
import {
  buildLocalLlamaArgs,
  normalizeLocalLlamaConfig,
} from "../../../src/main/services/local-llama-engine-service";

describe("local llama engine config", () => {
  it("uses safe single-machine defaults", () => {
    const config = normalizeLocalLlamaConfig({});
    expect(config).toEqual(DEFAULT_LOCAL_LLAMA_CONFIG);
    expect(config.parallel).toBe(1);
    expect(config.mtpEnabled).toBe(false);
  });

  it("builds argument arrays without a shell and keeps vision/MTP explicit", () => {
    const config = normalizeLocalLlamaConfig({
      ...DEFAULT_LOCAL_LLAMA_CONFIG,
      executablePath: "D:\\tools\\llama.cpp\\llama-server.exe",
      modelPath: "G:\\models\\text.gguf",
      mmprojPath: "G:\\models\\vision.gguf",
      mtpEnabled: true,
    });
    const args = buildLocalLlamaArgs(config);
    expect(args).toContain("prompthub-local");
    expect(args).toContain("127.0.0.1");
    expect(args).toContain("G:\\models\\vision.gguf");
    expect(args).toContain("draft-mtp");
    expect(args).toContain("--kv-unified");
    expect(args).not.toContain("&&");
  });

  it("omits the unified KV flag when the user turns it off", () => {
    const args = buildLocalLlamaArgs(
      normalizeLocalLlamaConfig({ ...DEFAULT_LOCAL_LLAMA_CONFIG, kvUnified: false }),
    );
    expect(args).not.toContain("--kv-unified");
  });

  it("lets llama.cpp fit GPU layers when the value is -1", () => {
    const args = buildLocalLlamaArgs(
      normalizeLocalLlamaConfig({ ...DEFAULT_LOCAL_LLAMA_CONFIG, gpuLayers: -1 }),
    );
    expect(args).not.toContain("--n-gpu-layers");
    expect(() => normalizeLocalLlamaConfig({ gpuLayers: -2 })).toThrow(/GPU layers/);
  });

  it("rejects invalid ports and unsupported cache types", () => {
    expect(() => normalizeLocalLlamaConfig({ port: 80 })).toThrow(/Port/);
    expect(() => normalizeLocalLlamaConfig({ kvCacheType: "unknown" })).toThrow(
      /KV cache/,
    );
  });

  it("validates the idle auto-release window", () => {
    expect(normalizeLocalLlamaConfig({}).idleUnloadMinutes).toBe(0);
    expect(normalizeLocalLlamaConfig({ idleUnloadMinutes: 30 }).idleUnloadMinutes).toBe(30);
    expect(() => normalizeLocalLlamaConfig({ idleUnloadMinutes: -1 })).toThrow(
      /Idle unload/,
    );
    expect(() => normalizeLocalLlamaConfig({ idleUnloadMinutes: 241 })).toThrow(
      /Idle unload/,
    );
  });
});
