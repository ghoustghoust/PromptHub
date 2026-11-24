import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PromptMossLayoutBox } from "@prompthub/shared/types";
import { usePromptOrchestratorWorkbench } from "../../../src/renderer/components/prompt/usePromptOrchestratorWorkbench";
import { settleConfirmation } from "../../../src/renderer/components/ui/confirmation";
import { useSettingsStore } from "../../../src/renderer/stores/settings.store";
import { installWindowMocks } from "../../helpers/window";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function box(id: string, caption = ""): PromptMossLayoutBox {
  return { id, label: "object", caption, bbox: [100, 100, 300, 300] };
}

function chatModel() {
  return {
    id: "chat",
    type: "chat" as const,
    provider: "openai",
    apiProtocol: "openai" as const,
    apiKey: "test-key",
    apiUrl: "https://example.com/v1",
    model: "gpt-4o-mini",
    isDefault: true,
  };
}

async function mountWorkbench() {
  const hook = renderHook(() => usePromptOrchestratorWorkbench());
  await waitFor(() => expect(hook.result.current.llmModelId).toBe("chat"));
  act(() => hook.result.current.setPrompt("A quiet street at dusk"));
  return hook;
}

describe("usePromptOrchestratorWorkbench layout safety", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    settleConfirmation(false);
    useSettingsStore.setState({
      aiModels: [chatModel()],
      modelRouteDefaults: { mainText: "chat" },
    } as Partial<ReturnType<typeof useSettingsStore.getState>>);
  });

  it("blocks orchestration and further assists while a layout assist is running", async () => {
    const pending = deferred<{
      ok: true;
      data: { captions: string[]; status: "complete"; warnings: string[] };
    }>();
    const refineLayoutCaptions = vi.fn().mockReturnValue(pending.promise);
    const run = vi.fn();
    installWindowMocks({ api: { promptOrchestrator: { refineLayoutCaptions, run } } });

    const hook = await mountWorkbench();
    act(() => {
      hook.result.current.mossLayout.addBox("object");
      hook.result.current.mossLayout.addBox("object");
    });
    expect(hook.result.current.canRun).toBe(true);

    let refinement!: Promise<void>;
    act(() => {
      refinement = hook.result.current.refineLayoutCaptions();
    });
    await waitFor(() => expect(hook.result.current.isAssistingLayout).toBe(true));
    expect(hook.result.current.canRun).toBe(false);

    await act(async () => {
      await hook.result.current.run();
      await hook.result.current.refineLayoutCaptions();
    });
    expect(run).not.toHaveBeenCalled();
    expect(refineLayoutCaptions).toHaveBeenCalledOnce();

    pending.resolve({ ok: true, data: { captions: ["one", "two"], status: "complete", warnings: [] } });
    await act(async () => {
      await refinement;
    });
    expect(hook.result.current.isAssistingLayout).toBe(false);
  });

  it("maps captions back by id and skips boxes deleted while the assist ran", async () => {
    const pending = deferred<{
      ok: true;
      data: { captions: string[]; status: "complete"; warnings: string[] };
    }>();
    installWindowMocks({
      api: { promptOrchestrator: { refineLayoutCaptions: vi.fn().mockReturnValue(pending.promise) } },
    });

    const hook = await mountWorkbench();
    act(() => {
      hook.result.current.mossLayout.setBoxes([box("a"), box("b")]);
      hook.result.current.mossLayout.setSelectedBoxId("a");
    });
    let refinement!: Promise<void>;
    act(() => {
      refinement = hook.result.current.refineLayoutCaptions();
    });
    await waitFor(() => expect(hook.result.current.isAssistingLayout).toBe(true));

    act(() => {
      hook.result.current.mossLayout.removeBox("a");
      hook.result.current.mossLayout.addBox("object");
    });
    pending.resolve({ ok: true, data: { captions: ["caption-a", "caption-b"], status: "complete", warnings: [] } });
    await act(async () => {
      await refinement;
    });

    const boxes = hook.result.current.mossLayout.boxes;
    expect(boxes.find((entry) => entry.id === "b")?.caption).toBe("caption-b");
    expect(boxes.some((entry) => entry.id === "a")).toBe(false);
    expect(boxes[boxes.length - 1].caption).toBe("");
  });

  it("asks before replacing a non-empty canvas and can undo the last reverse", async () => {
    const draft = { version: 1 as const, canvas: { width: 1024, height: 1024 }, boxes: [box("reversed")] };
    const reverseLayout = vi.fn().mockResolvedValue({
      ok: true,
      data: { draft, summary: "Poster", status: "complete", warnings: [] },
    });
    installWindowMocks({ api: { promptOrchestrator: { reverseLayout } } });

    const hook = await mountWorkbench();
    act(() => hook.result.current.mossLayout.setBoxes([box("kept")]));
    const file = new File(["image"], "poster.png", { type: "image/png" });

    let first!: Promise<void>;
    act(() => {
      first = hook.result.current.reverseLayoutFromImage(file);
    });
    await waitFor(() => expect(reverseLayout).not.toHaveBeenCalled());
    act(() => settleConfirmation(false));
    await act(async () => {
      await first;
    });
    expect(reverseLayout).not.toHaveBeenCalled();
    expect(hook.result.current.mossLayout.boxes.map((entry) => entry.id)).toEqual(["kept"]);

    let second!: Promise<void>;
    act(() => {
      second = hook.result.current.reverseLayoutFromImage(file);
    });
    act(() => settleConfirmation(true));
    await act(async () => {
      await second;
    });
    expect(reverseLayout).toHaveBeenCalledOnce();
    expect(hook.result.current.mossLayout.boxes.map((entry) => entry.id)).toEqual(["reversed"]);
    expect(hook.result.current.canUndoReverse).toBe(true);

    act(() => hook.result.current.undoReverseLayout());
    expect(hook.result.current.mossLayout.boxes.map((entry) => entry.id)).toEqual(["kept"]);
    expect(hook.result.current.canUndoReverse).toBe(false);
  });

  it("blocks captions and reverse while a main orchestration run is in flight", async () => {
    const pendingRun = deferred<{ ok: false; error: { code: string; message: string } }>();
    const run = vi.fn().mockReturnValue(pendingRun.promise);
    const refineLayoutCaptions = vi.fn();
    const reverseLayout = vi.fn();
    installWindowMocks({
      api: { promptOrchestrator: { run, refineLayoutCaptions, reverseLayout } },
    });

    const hook = await mountWorkbench();
    act(() => hook.result.current.mossLayout.addBox("object"));
    expect(hook.result.current.canRun).toBe(true);

    let runPromise!: Promise<void>;
    act(() => {
      runPromise = hook.result.current.run();
    });
    await waitFor(() => expect(hook.result.current.isRunning).toBe(true));

    const file = new File(["image"], "poster.png", { type: "image/png" });
    await act(async () => {
      await hook.result.current.refineLayoutCaptions();
      await hook.result.current.reverseLayoutFromImage(file);
    });
    expect(refineLayoutCaptions).not.toHaveBeenCalled();
    expect(reverseLayout).not.toHaveBeenCalled();

    pendingRun.resolve({ ok: false, error: { code: "CANCELLED", message: "stopped" } });
    await act(async () => {
      await runPromise;
    });
  });

  it("surfaces a workspace save failure instead of losing the canvas silently", async () => {
    const saveWorkspaceState = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: "BAD_REQUEST", message: "systemLayerText exceeds its length limit (60000)" },
    });
    installWindowMocks({ api: { promptOrchestrator: { saveWorkspaceState } } });

    const hook = renderHook(() => usePromptOrchestratorWorkbench());
    await waitFor(() => expect(saveWorkspaceState).toHaveBeenCalled(), { timeout: 3000 });
    await waitFor(() => expect(hook.result.current.error).not.toBe(""), { timeout: 3000 });
  });

  it("restores the canvas draft from the workspace and saves later edits", async () => {
    const stored = {
      prefabTerms: [],
      modelId: "",
      loraIds: "",
      mossLayout: {
        version: 1,
        canvas: { width: 1536, height: 1024 },
        boxes: [box("stored", "stored caption")],
      },
    };
    const saveWorkspaceState = vi.fn().mockResolvedValue({ ok: true, data: {} });
    installWindowMocks({
      api: {
        promptOrchestrator: {
          getWorkspaceState: vi.fn().mockResolvedValue({ ok: true, data: stored }),
          saveWorkspaceState,
        },
      },
    });

    const hook = renderHook(() => usePromptOrchestratorWorkbench());
    await waitFor(() => expect(hook.result.current.mossLayout.width).toBe("1536"));
    expect(hook.result.current.mossLayout.height).toBe("1024");
    expect(hook.result.current.mossLayout.ratio).toBe("3:2");
    expect(hook.result.current.mossLayout.boxes[0].caption).toBe("stored caption");

    act(() => hook.result.current.mossLayout.updateBox("stored", { caption: "edited caption" }));
    await waitFor(
      () => {
        const payloads = saveWorkspaceState.mock.calls.map((call) => call[0]);
        const last = payloads[payloads.length - 1];
        expect(last?.mossLayout?.boxes?.[0]?.caption).toBe("edited caption");
        expect(last?.mossLayout?.canvas).toEqual({ width: 1536, height: 1024 });
      },
      { timeout: 3000 },
    );
  });
});