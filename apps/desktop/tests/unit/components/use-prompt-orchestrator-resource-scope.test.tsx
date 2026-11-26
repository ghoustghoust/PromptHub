import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PromptKnowledgeModule,
  PromptKnowledgePack,
  PromptReferenceItem,
} from "@prompthub/shared/types";
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

const PACK: PromptKnowledgePack = {
  id: "pack-1",
  name: "Skill-Film",
  kind: "skill",
  sourcePath: "prompt/new/Skill-Film",
  sourceHash: "hash-pack",
  version: "2.0.1",
  status: "ready",
  createdAt: 1,
  updatedAt: 1,
};

const MODULE: PromptKnowledgeModule = {
  id: "module-1",
  packId: "pack-1",
  moduleKey: "action-choreography",
  title: "Action choreography",
  category: "narrative",
  priority: "P1",
  role: "knowledge",
  contractGroups: [],
  layer: "P",
  triggers: ["动作"],
  dependsOn: [],
  content: "Break every fight into spatial beats.",
  contentHash: "hash-module",
  tokens: 12,
  ord: 0,
};

const CONTRACT: PromptKnowledgeModule = {
  id: "contract-1",
  packId: "pack-1",
  moduleKey: "read-order",
  title: "Read order",
  role: "contract",
  contractGroups: [],
  layer: "H",
  triggers: [],
  dependsOn: [],
  content: "Read the pack before writing.",
  contentHash: "hash-contract",
  tokens: 5,
  ord: 1,
};

const REFERENCE: PromptReferenceItem = {
  id: "ref-1",
  nameZh: "测试导演",
  nameEn: "Test Director",
  category: "黑色悬疑与冷调惊悚",
  summary: "低饱和冷调，硬光切分空间。",
  palette: ["#112233"],
  style: { avoid: [] },
  thumbnailPath: "ref-1.jpg",
  sourcePath: "G:\\packs\\ref-1",
  sourceHash: "hash-ref-1",
  createdAt: 1,
  updatedAt: 1,
};

interface InstallOptions {
  stored?: Record<string, unknown>;
}

function install(options: InstallOptions = {}) {
  const run = vi.fn().mockResolvedValue({
    ok: false,
    error: { code: "CANCELLED", message: "stopped" },
  });
  installWindowMocks({
    api: {
      promptKnowledge: {
        listPacks: vi.fn().mockResolvedValue({ ok: true, data: [PACK] }),
        listModules: vi.fn().mockResolvedValue({
          ok: true,
          data: [MODULE, CONTRACT],
        }),
      },
      promptReference: {
        list: vi.fn().mockResolvedValue({ ok: true, data: [REFERENCE] }),
      },
      promptOrchestrator: {
        getWorkspaceState: vi.fn().mockResolvedValue({
          ok: true,
          data: {
            prefabTerms: [],
            modelId: "",
            loraIds: "",
            ...(options.stored ?? {}),
          },
        }),
        saveWorkspaceState: vi.fn().mockResolvedValue({ ok: true, data: {} }),
        run,
      },
    },
  });
  return { run };
}

describe("orchestrator resource scope across task types", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useSettingsStore.setState({
      aiModels: [chatModel()],
      modelRouteDefaults: { mainText: "chat" },
    } as Partial<ReturnType<typeof useSettingsStore.getState>>);
  });

  it("keeps the selected writing layer, knowledge modules and color card in a video run", async () => {
    const { run } = install({
      stored: {
        systemLayerText: "冷调硬光，固定机位。",
        knowledgePackIds: ["pack-1"],
        knowledgeModuleIds: ["module-1"],
        referenceItemIds: ["ref-1"],
      },
    });

    const hook = renderHook(() => usePromptOrchestratorWorkbench());
    await waitFor(() => expect(hook.result.current.knowledgeModules.length).toBeGreaterThan(0));
    await waitFor(() => expect(hook.result.current.selectedReferenceItems).toHaveLength(1));

    act(() => hook.result.current.setSkill("minimaxH3"));
    expect(hook.result.current.mode).toBe("video-text");
    act(() => hook.result.current.setPrompt("a duel"));
    await act(async () => {
      await hook.result.current.run();
    });

    expect(run).toHaveBeenCalledOnce();
    const input = run.mock.calls[0][0].input;
    expect(input.mode).toBe("video-text");
    expect(input.systemPromptLayer).toBe("冷调硬光，固定机位。");
    expect(input.knowledgeModules).toEqual([
      expect.objectContaining({ id: "contract-1" }),
      expect.objectContaining({ id: "module-1" }),
    ]);
    expect(input.referenceStyles).toEqual([
      expect.objectContaining({ id: "ref-1", nameZh: "测试导演" }),
    ]);
  });

  it("drops the color card from the video run once it is deselected", async () => {
    const { run } = install({
      stored: {
        knowledgePackIds: ["pack-1"],
        knowledgeModuleIds: ["module-1"],
        referenceItemIds: ["ref-1"],
      },
    });

    const hook = renderHook(() => usePromptOrchestratorWorkbench());
    await waitFor(() => expect(hook.result.current.selectedReferenceItems).toHaveLength(1));

    act(() => hook.result.current.setSkill("minimaxH3"));
    act(() => hook.result.current.toggleReferenceItem("ref-1"));
    expect(hook.result.current.referenceItemIds).toEqual([]);

    act(() => hook.result.current.setPrompt("a duel"));
    await act(async () => {
      await hook.result.current.run();
    });

    const input = run.mock.calls[0][0].input;
    expect(input.referenceStyles).toBeUndefined();
  });

  it("never sends the hidden image-only artist pipeline to a video run", async () => {
    const { run } = install();

    const hook = renderHook(() => usePromptOrchestratorWorkbench());
    act(() => hook.result.current.setTargetPipeline("anima"));
    act(() => hook.result.current.setSkill("minimaxH3"));
    act(() => hook.result.current.setPrompt("a duel"));
    await act(async () => {
      await hook.result.current.run();
    });

    const input = run.mock.calls[0][0].input;
    expect(input.targetPipeline).toBeUndefined();
  });

  it("keeps the artist pipeline for an image run", async () => {
    const { run } = install();

    const hook = renderHook(() => usePromptOrchestratorWorkbench());
    act(() => hook.result.current.setTargetPipeline("anima"));
    act(() => hook.result.current.setPrompt("a duel"));
    await act(async () => {
      await hook.result.current.run();
    });

    const input = run.mock.calls[0][0].input;
    expect(input.mode).toBe("expand");
    expect(input.targetPipeline).toBe("anima");
  });
});
