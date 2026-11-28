import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useScriptFlow } from "../../../src/renderer/components/prompt/useScriptFlow";

const saveScriptFlow = vi.fn(async (flow: unknown) => ({ ok: true as const, data: flow }));
const selectImage = vi.fn(async () => ["C:\\frames\\unit-01.png"]);
const saveImage = vi.fn(async () => ["stored-unit-01.png"]);

function installMocks() {
  Object.defineProperty(window, "api", {
    configurable: true,
    value: {
      promptOrchestrator: {
        getScriptFlow: vi.fn(async () => ({ ok: true, data: null })),
        saveScriptFlow,
      },
    },
  });
  Object.defineProperty(window, "electron", {
    configurable: true,
    value: { selectImage, saveImage },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  installMocks();
});

describe("useScriptFlow materials", () => {
  it("starts text only and stores the branch on the flow", async () => {
    const { result } = renderHook(() => useScriptFlow());
    expect(result.current.materials.mode).toBe("text");

    act(() => result.current.setMaterialMode("first-last"));
    expect(result.current.materials.mode).toBe("first-last");
    expect(result.current.materials.slots.map((slot) => slot.kind)).toEqual([
      "first-frame",
      "last-frame",
    ]);

    await waitFor(() => expect(saveScriptFlow).toHaveBeenCalled());
    const saved = saveScriptFlow.mock.calls.at(-1)?.[0] as {
      settings?: { materials?: { mode: string } };
    };
    expect(saved.settings?.materials?.mode).toBe("first-last");
  });

  it("records the picked image against the slot it was filled for", async () => {
    const { result } = renderHook(() => useScriptFlow());
    act(() => result.current.setMaterialMode("first-frame"));
    await act(async () => {
      await result.current.fillMaterialSlot("first-frame");
    });

    expect(selectImage).toHaveBeenCalled();
    expect(saveImage).toHaveBeenCalledWith(["C:\\frames\\unit-01.png"]);
    expect(result.current.materials.slots[0]).toMatchObject({
      kind: "first-frame",
      fileName: "stored-unit-01.png",
      label: "unit-01.png",
    });
    expect(result.current.missingMaterialCount).toBe(0);
  });

  it("keeps an added image when the reference count grows", async () => {
    const { result } = renderHook(() => useScriptFlow());
    act(() => result.current.setMaterialMode("references"));
    await act(async () => {
      await result.current.fillMaterialSlot("reference", 1);
    });
    act(() => result.current.setReferenceCount(4));
    expect(result.current.materials.slots).toHaveLength(4);
    expect(result.current.materials.slots[0].fileName).toBe("stored-unit-01.png");
    expect(result.current.missingMaterialCount).toBe(3);
  });

  it("clears a filled slot back to waiting", async () => {
    const { result } = renderHook(() => useScriptFlow());
    act(() => result.current.setMaterialMode("first-frame"));
    await act(async () => {
      await result.current.fillMaterialSlot("first-frame");
    });
    act(() => result.current.clearMaterialSlot("first-frame"));
    expect(result.current.materials.slots[0].fileName).toBeUndefined();
    expect(result.current.missingMaterialCount).toBe(1);
  });
});