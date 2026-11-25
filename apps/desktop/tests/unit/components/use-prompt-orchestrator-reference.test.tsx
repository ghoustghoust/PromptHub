import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PromptReferenceItem } from "@prompthub/shared/types";
import { usePromptOrchestratorWorkbench } from "../../../src/renderer/components/prompt/usePromptOrchestratorWorkbench";
import { useSettingsStore } from "../../../src/renderer/stores/settings.store";
import { installWindowMocks } from "../../helpers/window";

function reference(index: number): PromptReferenceItem {
  return {
    id: `ref-${index}`,
    nameZh: `导演${index}`,
    category: "黑色悬疑与冷调惊悚",
    summary: "冷调",
    palette: ["#112233"],
    style: { avoid: [] },
    thumbnailPath: `ref-${index}.jpg`,
    sourcePath: `G:\\packs\\ref-${index}`,
    sourceHash: `hash-${index}`,
    createdAt: 1,
    updatedAt: 1,
  };
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

describe("reference color card selection", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useSettingsStore.setState({
      aiModels: [chatModel()],
      modelRouteDefaults: { mainText: "chat" },
    } as Partial<ReturnType<typeof useSettingsStore.getState>>);
  });

  it("loads the library, caps selection at three and persists ids", async () => {
    const saveWorkspaceState = vi.fn().mockResolvedValue({ ok: true, data: {} });
    installWindowMocks({
      api: {
        promptReference: {
          list: vi.fn().mockResolvedValue({ ok: true, data: [1, 2, 3, 4].map(reference) }),
        },
        promptOrchestrator: {
          getWorkspaceState: vi.fn().mockResolvedValue({
            ok: true,
            data: { prefabTerms: [], modelId: "", loraIds: "", referenceItemIds: ["ref-1"] },
          }),
          saveWorkspaceState,
        },
      },
    });

    const hook = renderHook(() => usePromptOrchestratorWorkbench());
    await waitFor(() => expect(hook.result.current.referenceItems).toHaveLength(4));
    await waitFor(() => expect(hook.result.current.selectedReferenceItems).toHaveLength(1));

    act(() => hook.result.current.toggleReferenceItem("ref-2"));
    act(() => hook.result.current.toggleReferenceItem("ref-3"));
    act(() => hook.result.current.toggleReferenceItem("ref-4"));
    expect(hook.result.current.referenceItemIds).toEqual(["ref-1", "ref-2", "ref-3"]);
    expect(hook.result.current.selectedReferenceItems).toHaveLength(3);

    await waitFor(() => {
      const payloads = saveWorkspaceState.mock.calls.map((call) => call[0]);
      const last = payloads[payloads.length - 1];
      expect(last?.referenceItemIds).toEqual(["ref-1", "ref-2", "ref-3"]);
    }, { timeout: 3000 });
  });
});