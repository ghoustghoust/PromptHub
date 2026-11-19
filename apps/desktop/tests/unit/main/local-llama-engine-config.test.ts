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
    expect(args).not.toContain("&&");
  });

  it("rejects invalid ports and unsupported cache types", () => {
    expect(() => normalizeLocalLlamaConfig({ port: 80 })).toThrow(/Port/);
    expect(() => normalizeLocalLlamaConfig({ kvCacheType: "unknown" })).toThrow(
      /KV cache/,
    );
  });
});
