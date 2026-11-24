import { describe, expect, it, vi } from "vitest";
import { LocalLlamaEngineService } from "../../../src/main/services/local-llama-engine-service";

describe("local engine start stages", () => {
  it("maps llama-server output to coarse stages and ignores it once running", () => {
    const service = new LocalLlamaEngineService(process.cwd());
    const internals = service as unknown as {
      phase: string;
      stage: string;
      advanceStage: (text: string) => void;
    };
    internals.phase = "starting";
    internals.advanceStage("llama_model_loader: loading model");
    expect(internals.stage).toBe("load-weights");
    internals.advanceStage("load_tensors: loading model tensors");
    expect(internals.stage).toBe("load-weights");
    internals.advanceStage("main: model loaded");
    expect(internals.stage).toBe("health-check");
    internals.phase = "running";
    internals.advanceStage("llama_model_loader: another load?");
    expect(internals.stage).toBe("health-check");
  });

  it("records event-loop percentiles for the last start", () => {
    const service = new LocalLlamaEngineService(process.cwd());
    const internals = service as unknown as {
      startEventLoopMonitor: () => void;
      stopEventLoopMonitor: () => void;
      eventLoopDelayMs: { p50: number; p95: number; max: number } | null;
    };
    internals.startEventLoopMonitor();
    internals.stopEventLoopMonitor();
    expect(internals.eventLoopDelayMs).toMatchObject({
      p50: expect.any(Number),
      p95: expect.any(Number),
      max: expect.any(Number),
    });
    expect(internals.eventLoopDelayMs?.p95).toBeGreaterThanOrEqual(
      internals.eventLoopDelayMs?.p50 ?? 0,
    );
  });
});
