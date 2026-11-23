import { describe, expect, it } from "vitest";
import { DEFAULT_LOCAL_LLAMA_CONFIG } from "@prompthub/shared/types";
import {
  buildLocalLlamaArgs,
  estimateLocalLlamaVramMb,
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
    expect(args).toContain("--jinja");
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

  it("keeps KV on the GPU for the 8K default", () => {
    const config = normalizeLocalLlamaConfig({});
    expect(config.kvOffload).toBe(true);
    const args = buildLocalLlamaArgs(config);
    expect(args).toContain("--kv-offload");
    expect(args).not.toContain("--no-kv-offload");
  });

  it("forces q4 host KV for 32K and above so manual input cannot bypass the preset", () => {
    const config = normalizeLocalLlamaConfig({
      contextSize: 32768,
      kvCacheType: "f16",
      kvOffload: true,
    });
    expect(config.contextSize).toBe(32768);
    expect(config.kvCacheType).toBe("q4_0");
    expect(config.kvOffload).toBe(false);
    const args = buildLocalLlamaArgs(config);
    expect(args).toContain("--no-kv-offload");
    expect(args).not.toContain("--kv-offload");
  });

  it("estimates context VRAM including the vision projector", () => {
    const text64 = estimateLocalLlamaVramMb({
      contextSize: 65536,
      mmprojPath: "",
      parallel: 1,
    });
    const vision64 = estimateLocalLlamaVramMb({
      contextSize: 65536,
      mmprojPath: "G:\\models\\vision.gguf",
      parallel: 1,
    });
    expect(text64).toBe(6400);
    expect(vision64).toBe(6800);
    expect(
      estimateLocalLlamaVramMb({
        contextSize: 262144,
        mmprojPath: "",
        parallel: 1,
      }),
    ).toBeGreaterThan(text64);
  });

  it("validates invalid ports and unsupported cache types", () => {
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

  it("validates model profiles and the ComfyUI address", () => {
    const config = normalizeLocalLlamaConfig({
      modelProfiles: [
        { id: "p1", name: "MTP 9B", modelPath: "G:\\models\\mtp.gguf", mtpEnabled: true },
      ],
    });
    expect(config.modelProfiles[0]).toMatchObject({
      id: "p1",
      name: "MTP 9B",
      contextSize: 8192,
      gpuLayers: 99,
      mtpEnabled: true,
      mtpDraftMax: 2,
    });
    expect(() =>
      normalizeLocalLlamaConfig({
        modelProfiles: [{ id: "", name: "bad", modelPath: "x.gguf" }],
      }),
    ).toThrow(/id and a name/);
    expect(() =>
      normalizeLocalLlamaConfig({
        modelProfiles: [{ id: "p", name: "bad" }],
      }),
    ).toThrow(/model path/);
    expect(normalizeLocalLlamaConfig({ comfyUrl: "" }).comfyUrl).toBe("");
    expect(() => normalizeLocalLlamaConfig({ comfyUrl: "file:///x" })).toThrow(/http/);
  });
});
