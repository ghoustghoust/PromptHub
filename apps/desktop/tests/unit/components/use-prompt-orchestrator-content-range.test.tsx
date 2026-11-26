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

interface InstallOptions {
  stored?: Record<string, unknown>;
}

function install(options: InstallOptions = {}) {
  const run = vi.fn().mockResolvedValue({
    ok: false,
    error: { code: "CANCELLED", message: "stopped" },
  });
  const saveWorkspaceState = vi.fn().mockResolvedValue({ ok: true, data: {} });
  installWindowMocks({
    api: {
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
        run,
      },
    },
  });
  return { run, saveWorkspaceState };
}

async function runOnce(hook: { result: { current: ReturnType<typeof usePromptOrchestratorWorkbench> } }) {
  act(() => hook.result.current.setPrompt("two adults in a dim room"));
  await act(async () => {
    await hook.result.current.run();
  });
}

describe("orchestrator content range", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useSettingsStore.setState({
      aiModels: [chatModel()],
      modelRouteDefaults: { mainText: "chat" },
    } as Partial<ReturnType<typeof useSettingsStore.getState>>);
  });

  it("keeps the all-ages default and sends no adult flag", async () => {
    const { run, saveWorkspaceState } = install();

    const hook = renderHook(() => usePromptOrchestratorWorkbench());
    await waitFor(() => expect(hook.result.current.allowAdult).toBe(false));
    await runOnce(hook);

    const input = run.mock.calls[0][0].input;
    expect(input.allowAdult).toBeUndefined();
    await waitFor(() => {
      const payloads = saveWorkspaceState.mock.calls.map((call) => call[0]);
      const last = payloads[payloads.length - 1];
      expect(last?.allowAdult).toBe(false);
    }, { timeout: 3000 });
  });

  it("sends the allowed adult branch and persists it", async () => {
    const { run, saveWorkspaceState } = install();

    const hook = renderHook(() => usePromptOrchestratorWorkbench());
    await waitFor(() => expect(hook.result.current.allowAdult).toBe(false));

    act(() => hook.result.current.setAllowAdult(true));
    expect(hook.result.current.allowAdult).toBe(true);
    await runOnce(hook);

    const input = run.mock.calls[0][0].input;
    expect(input.allowAdult).toBe(true);
    await waitFor(() => {
      const payloads = saveWorkspaceState.mock.calls.map((call) => call[0]);
      const last = payloads[payloads.length - 1];
      expect(last?.allowAdult).toBe(true);
    }, { timeout: 3000 });
  });

  it("restores the stored content range after a reload", async () => {
    install({ stored: { allowAdult: true } });

    const hook = renderHook(() => usePromptOrchestratorWorkbench());
    await waitFor(() => expect(hook.result.current.allowAdult).toBe(true));
  });
});
