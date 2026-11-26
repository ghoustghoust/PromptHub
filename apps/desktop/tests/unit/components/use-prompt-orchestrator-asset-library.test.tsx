import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePromptOrchestratorWorkbench } from "../../../src/renderer/components/prompt/usePromptOrchestratorWorkbench";
import { useSettingsStore } from "../../../src/renderer/stores/settings.store";
import { installWindowMocks } from "../../helpers/window";

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

const ASSET = {
  id: "ghil:costume:SPR-0001",
  kind: "costume",
  path: "G:\\packs\\costume\\img\\SPR-0001.jpg",
  title: "象牙白针织",
  meta: {},
  createdAt: 1,
};

describe("picture library in the workbench", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useSettingsStore.setState({
      aiModels: [chatModel()],
      modelRouteDefaults: { mainText: "chat" },
    } as Partial<ReturnType<typeof useSettingsStore.getState>>);
  });

  it("reads the material page and its pictures", async () => {
    const list = vi.fn().mockResolvedValue({
      ok: true,
      data: { items: [ASSET], total: 5238 },
    });
    const thumbnails = vi.fn().mockResolvedValue({
      ok: true,
      data: { "ghil:costume:SPR-0001": "data:image/jpeg;base64,AAA" },
    });
    installWindowMocks({
      api: {
        promptAsset: {
          list,
          kindCounts: vi.fn().mockResolvedValue({
            ok: true,
            data: [{ kind: "costume", count: 1407 }],
          }),
          thumbnails,
        },
      },
    });

    const hook = renderHook(() => usePromptOrchestratorWorkbench());
    await waitFor(() => expect(hook.result.current.assetItems).toHaveLength(1));
    expect(hook.result.current.assetTotal).toBe(5238);
    expect(hook.result.current.assetKindCounts).toEqual([{ kind: "costume", count: 1407 }]);
    await waitFor(() =>
      expect(hook.result.current.assetThumbnails["ghil:costume:SPR-0001"]).toBe(
        "data:image/jpeg;base64,AAA",
      ),
    );
    expect(thumbnails).toHaveBeenCalledWith({ ids: ["ghil:costume:SPR-0001"] });
  });

  it("marks a material and keeps the mark in the workspace", async () => {
    const saveWorkspaceState = vi.fn().mockResolvedValue({ ok: true, data: {} });
    installWindowMocks({
      api: {
        promptAsset: {
          list: vi.fn().mockResolvedValue({ ok: true, data: { items: [ASSET], total: 1 } }),
          kindCounts: vi.fn().mockResolvedValue({ ok: true, data: [] }),
          thumbnails: vi.fn().mockResolvedValue({ ok: true, data: {} }),
        },
        promptOrchestrator: {
          getWorkspaceState: vi.fn().mockResolvedValue({
            ok: true,
            data: { prefabTerms: [], modelId: "", loraIds: "" },
          }),
          saveWorkspaceState,
        },
      },
    });

    const hook = renderHook(() => usePromptOrchestratorWorkbench());
    await waitFor(() => expect(hook.result.current.assetItems).toHaveLength(1));

    act(() => hook.result.current.toggleAsset("ghil:costume:SPR-0001"));
    expect(hook.result.current.selectedAssetIds).toEqual(["ghil:costume:SPR-0001"]);
    await waitFor(() => {
      const payloads = saveWorkspaceState.mock.calls.map((call) => call[0]);
      const last = payloads[payloads.length - 1];
      expect(last?.selectedAssetIds).toEqual(["ghil:costume:SPR-0001"]);
    }, { timeout: 3000 });
  });

  it("restores the marked materials after a reload", async () => {
    installWindowMocks({
      api: {
        promptAsset: {
          list: vi.fn().mockResolvedValue({ ok: true, data: { items: [], total: 0 } }),
          kindCounts: vi.fn().mockResolvedValue({ ok: true, data: [] }),
          thumbnails: vi.fn().mockResolvedValue({ ok: true, data: {} }),
        },
        promptOrchestrator: {
          getWorkspaceState: vi.fn().mockResolvedValue({
            ok: true,
            data: {
              prefabTerms: [],
              modelId: "",
              loraIds: "",
              selectedAssetIds: ["ghil:pose:P001:front"],
            },
          }),
          saveWorkspaceState: vi.fn().mockResolvedValue({ ok: true, data: {} }),
        },
      },
    });

    const hook = renderHook(() => usePromptOrchestratorWorkbench());
    await waitFor(() =>
      expect(hook.result.current.selectedAssetIds).toEqual(["ghil:pose:P001:front"]),
    );
  });
});
