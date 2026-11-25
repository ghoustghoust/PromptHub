import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PromptKnowledgeModule, PromptKnowledgePack } from "@prompthub/shared/types";
import { PromptWritingLayerPanel } from "../../../src/renderer/components/prompt/PromptWritingLayerPanel";
import { EMPTY_WRITING_LAYER } from "../../../src/renderer/components/prompt/prompt-writing-layer";
import { renderWithI18n } from "../../helpers/i18n";
import { installWindowMocks } from "../../helpers/window";

const PACK: PromptKnowledgePack = {
  id: "pack-1",
  name: "Skill-Film",
  kind: "skill",
  sourceHash: "pack-hash",
  version: "2.0.1",
  status: "ready",
  createdAt: 1,
  updatedAt: 1,
};

const MODULE: PromptKnowledgeModule = {
  id: "module-1",
  packId: "pack-1",
  moduleKey: "action",
  title: "Action choreography",
  layer: "P",
  triggers: [],
  dependsOn: [],
  content: "content",
  contentHash: "hash",
  tokens: 42,
  ord: 0,
};

function renderPanel(overrides: {
  packIds?: string[];
  moduleIds?: string[];
  onTogglePack?: () => void;
  onToggleModule?: () => void;
} = {}) {
  return renderWithI18n(
    <PromptWritingLayerPanel
      selection={EMPTY_WRITING_LAYER}
      text=""
      source={null}
      contextTokens={8192}
      contextLocked={false}
      budget={null}
      budgetError=""
      knowledgePacks={[PACK]}
      knowledgeModulesByPack={{ "pack-1": [MODULE] }}
      knowledgePackIds={overrides.packIds ?? []}
      knowledgeModuleIds={overrides.moduleIds ?? []}
      knowledgeTokens={0}
      onSelectionChange={() => undefined}
      onTextChange={() => undefined}
      onContextTokensChange={() => undefined}
      onToggleKnowledgePack={overrides.onTogglePack ?? (() => undefined)}
      onToggleKnowledgeModule={overrides.onToggleModule ?? (() => undefined)}
    />,
    { language: "en" },
  );
}

describe("PromptWritingLayerPanel knowledge packs", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    installWindowMocks({
      api: {
        promptWritingPresets: {
          list: vi.fn().mockResolvedValue({ ok: true, data: [] }),
          get: vi.fn().mockResolvedValue({ ok: true, data: null }),
        },
      },
    });
  });

  it("lists imported packs and toggles them", async () => {
    const onTogglePack = vi.fn();
    await renderPanel({ onTogglePack });

    expect(screen.getByTestId("writing-layer-knowledge")).toBeTruthy();
    expect(screen.getByText("Skill-Film")).toBeTruthy();
    fireEvent.click(screen.getByTestId("writing-layer-knowledge-pack-pack-1"));
    expect(onTogglePack).toHaveBeenCalledWith("pack-1");
  });

  it("shows modules of a selected pack and toggles one", async () => {
    const onToggleModule = vi.fn();
    await renderPanel({ packIds: ["pack-1"], onToggleModule });

    expect(screen.getByText("Action choreography")).toBeTruthy();
    fireEvent.click(screen.getByTestId("writing-layer-knowledge-module-module-1"));
    expect(onToggleModule).toHaveBeenCalledWith("module-1");
  });

  it("counts selected module tokens in the meter", async () => {
    await renderWithI18n(
      <PromptWritingLayerPanel
        selection={EMPTY_WRITING_LAYER}
        text="one two"
        source={null}
        contextTokens={8192}
        contextLocked={false}
        budget={null}
        budgetError=""
        knowledgePacks={[PACK]}
        knowledgeModulesByPack={{ "pack-1": [MODULE] }}
        knowledgePackIds={["pack-1"]}
        knowledgeModuleIds={["module-1"]}
        knowledgeTokens={42}
        onSelectionChange={() => undefined}
        onTextChange={() => undefined}
        onContextTokensChange={() => undefined}
        onToggleKnowledgePack={() => undefined}
        onToggleKnowledgeModule={() => undefined}
      />,
      { language: "en" },
    );

    expect(screen.getByTestId("writing-layer-tokens").textContent).toContain("44");
  });
});