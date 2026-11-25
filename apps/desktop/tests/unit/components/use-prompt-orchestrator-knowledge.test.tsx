import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PromptKnowledgeImportPreview, PromptKnowledgeModule, PromptKnowledgePack } from "@prompthub/shared/types";
import { usePromptOrchestratorWorkbench } from "../../../src/renderer/components/prompt/usePromptOrchestratorWorkbench";
import { settleConfirmation, useConfirmationState } from "../../../src/renderer/components/ui/confirmation";
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
  layer: "P",
  triggers: ["动作"],
  dependsOn: [],
  content: "Break every fight into spatial beats.",
  contentHash: "hash-module",
  tokens: 12,
  ord: 0,
};

const PREVIEW: PromptKnowledgeImportPreview = {
  packs: [{
    name: "Skill-Film",
    kind: "skill",
    sourcePath: "C:\\packs\\Skill-Film",
    version: "2.0.1",
    modules: [{
      moduleKey: "action-choreography",
      title: "Action choreography",
      layer: "P",
      triggers: [],
      dependsOn: [],
      tokens: 12,
      bytes: 40,
      contentHash: "hash-module",
      ord: 0,
    }],
    skipped: [],
  }],
  moduleCount: 1,
  totalBytes: 40,
  totalTokens: 12,
  skipped: [],
  conflicts: [],
};

function install(options: {
  packs?: PromptKnowledgePack[];
  modules?: PromptKnowledgeModule[];
  stored?: Record<string, unknown>;
  run?: ReturnType<typeof vi.fn>;
  saveWorkspaceState?: ReturnType<typeof vi.fn>;
  listPacks?: ReturnType<typeof vi.fn>;
  commitImport?: ReturnType<typeof vi.fn>;
  removePack?: ReturnType<typeof vi.fn>;
} = {}) {
  const listPacks = options.listPacks
    ?? vi.fn().mockResolvedValue({ ok: true, data: options.packs ?? [PACK] });
  const listModules = vi.fn().mockResolvedValue({ ok: true, data: options.modules ?? [MODULE] });
  const commitImport = options.commitImport
    ?? vi.fn().mockResolvedValue({
      ok: true,
      data: { packIds: ["pack-2"], moduleCount: 1, skipped: [], conflicts: [] },
    });
  const removePack = options.removePack
    ?? vi.fn().mockResolvedValue({ ok: true, data: { removed: true } });
  const saveWorkspaceState = options.saveWorkspaceState
    ?? vi.fn().mockResolvedValue({ ok: true, data: {} });
  installWindowMocks({
    api: {
      promptKnowledge: { listPacks, listModules, commitImport, removePack },
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
        saveWorkspaceState,
        run: options.run ?? vi.fn(),
      },
    },
  });
  return { listPacks, listModules, saveWorkspaceState, commitImport, removePack };
}

describe("knowledge pack selection in the workbench", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useSettingsStore.setState({
      aiModels: [chatModel()],
      modelRouteDefaults: { mainText: "chat" },
    } as Partial<ReturnType<typeof useSettingsStore.getState>>);
  });

  it("restores selected ids, loads their modules and sends them to the run", async () => {
    const run = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: "CANCELLED", message: "stopped" },
    });
    install({
      stored: { knowledgePackIds: ["pack-1"], knowledgeModuleIds: ["module-1"] },
      run,
    });

    const hook = renderHook(() => usePromptOrchestratorWorkbench());
    await waitFor(() => expect(hook.result.current.knowledgePacks).toHaveLength(1));
    await waitFor(() => expect(hook.result.current.knowledgeTokens).toBe(12));
    expect(hook.result.current.knowledgePackIds).toEqual(["pack-1"]);
    expect(hook.result.current.knowledgeModuleIds).toEqual(["module-1"]);

    act(() => hook.result.current.setPrompt("a duel"));
    await act(async () => {
      await hook.result.current.run();
    });

    expect(run).toHaveBeenCalledOnce();
    const input = run.mock.calls[0][0].input;
    expect(input.knowledgeModules).toEqual([
      expect.objectContaining({
        id: "module-1",
        packId: "pack-1",
        packName: "Skill-Film",
        moduleKey: "action-choreography",
        title: "Action choreography",
        layer: "P",
        tokens: 12,
        content: "Break every fight into spatial beats.",
      }),
    ]);
  });

  it("persists toggles and drops a module when its pack is deselected", async () => {
    const saveWorkspaceState = vi.fn().mockResolvedValue({ ok: true, data: {} });
    install({
      stored: { knowledgePackIds: ["pack-1"], knowledgeModuleIds: ["module-1"] },
      saveWorkspaceState,
    });

    const hook = renderHook(() => usePromptOrchestratorWorkbench());
    await waitFor(() => expect(hook.result.current.knowledgeTokens).toBe(12));

    act(() => hook.result.current.toggleKnowledgePack("pack-1"));
    expect(hook.result.current.knowledgePackIds).toEqual([]);
    expect(hook.result.current.knowledgeModuleIds).toEqual([]);
    await waitFor(() => {
      const payloads = saveWorkspaceState.mock.calls.map((call) => call[0]);
      const last = payloads[payloads.length - 1];
      expect(last?.knowledgePackIds).toEqual([]);
      expect(last?.knowledgeModuleIds).toEqual([]);
    }, { timeout: 3000 });

    act(() => hook.result.current.toggleKnowledgePack("pack-1"));
    await waitFor(() => expect(hook.result.current.knowledgePacks).toHaveLength(1));
    act(() => hook.result.current.toggleKnowledgeModule("module-1"));
    expect(hook.result.current.knowledgeModuleIds).toEqual(["module-1"]);
    await waitFor(() => {
      const payloads = saveWorkspaceState.mock.calls.map((call) => call[0]);
      const last = payloads[payloads.length - 1];
      expect(last?.knowledgeModuleIds).toEqual(["module-1"]);
    }, { timeout: 3000 });
  });

  it("commits an imported preview, refreshes packs and selects the new pack", async () => {
    const listPacks = vi.fn()
      .mockResolvedValueOnce({ ok: true, data: [] })
      .mockResolvedValueOnce({ ok: true, data: [{ ...PACK, id: "pack-2" }] });
    const commitImport = vi.fn().mockResolvedValue({
      ok: true,
      data: { packIds: ["pack-2"], moduleCount: 1, skipped: [], conflicts: [] },
    });
    install({ listPacks, commitImport });

    const hook = renderHook(() => usePromptOrchestratorWorkbench());
    await waitFor(() => expect(hook.result.current.knowledgePacks).toHaveLength(0));

    let result: Awaited<ReturnType<typeof hook.result.current.importKnowledgePack>> = null;
    await act(async () => {
      result = await hook.result.current.importKnowledgePack(PREVIEW);
    });

    expect(commitImport).toHaveBeenCalledWith({ preview: PREVIEW });
    expect(result?.packIds).toEqual(["pack-2"]);
    await waitFor(() => expect(hook.result.current.knowledgePacks).toHaveLength(1));
    expect(hook.result.current.knowledgePackIds).toEqual(["pack-2"]);
  });

  it("deletes a pack after confirmation and drops its selection", async () => {
    const listPacks = vi.fn()
      .mockResolvedValueOnce({ ok: true, data: [PACK] })
      .mockResolvedValueOnce({ ok: true, data: [] });
    const removePack = vi.fn().mockResolvedValue({ ok: true, data: { removed: true } });
    install({
      stored: { knowledgePackIds: ["pack-1"], knowledgeModuleIds: ["module-1"] },
      listPacks,
      removePack,
    });

    const hook = renderHook(() => usePromptOrchestratorWorkbench());
    await waitFor(() => expect(hook.result.current.knowledgeTokens).toBe(12));

    let deleting!: Promise<void>;
    act(() => {
      deleting = hook.result.current.deleteKnowledgePack("pack-1");
    });
    await waitFor(() => expect(useConfirmationState.getState().pending).not.toBeNull());
    act(() => settleConfirmation(false));
    await act(async () => {
      await deleting;
    });
    expect(removePack).not.toHaveBeenCalled();
    expect(hook.result.current.knowledgePacks).toHaveLength(1);

    act(() => {
      deleting = hook.result.current.deleteKnowledgePack("pack-1");
    });
    await waitFor(() => expect(useConfirmationState.getState().pending).not.toBeNull());
    act(() => settleConfirmation(true));
    await act(async () => {
      await deleting;
    });

    expect(removePack).toHaveBeenCalledWith("pack-1");
    expect(hook.result.current.knowledgePackIds).toEqual([]);
    expect(hook.result.current.knowledgeModuleIds).toEqual([]);
    await waitFor(() => expect(hook.result.current.knowledgePacks).toHaveLength(0));
  });
});