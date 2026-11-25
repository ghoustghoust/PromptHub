import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PromptKnowledgeImportCommitResult,
  PromptKnowledgeImportPreview,
  PromptKnowledgeModule,
  PromptKnowledgePack,
} from "@prompthub/shared/types";
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
  role: "knowledge",
  contractGroups: [],
  layer: "P",
  triggers: [],
  dependsOn: [],
  content: "content",
  contentHash: "hash",
  tokens: 42,
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
  content: "contract content",
  contentHash: "hash-contract",
  tokens: 5,
  ord: 1,
};

const PREVIEW: PromptKnowledgeImportPreview = {
  packs: [{
    name: "Skill-Film",
    kind: "skill",
    sourcePath: "C:\\packs\\Skill-Film",
    version: "2.0.1",
    modules: [{
      moduleKey: "action",
      title: "Action choreography",
role: "knowledge",
      contractGroups: [],
      layer: "P",
      triggers: [],
      dependsOn: [],
      tokens: 42,
      bytes: 100,
      contentHash: "hash",
      ord: 0,
    }],
    skipped: [{ path: "知识/源/old.md", reason: "source copy is skipped" }],
  }],
  moduleCount: 1,
  totalBytes: 100,
  totalTokens: 42,
  skipped: [{ path: "知识/源/old.md", reason: "source copy is skipped" }],
  conflicts: [{
    packName: "Skill-Film",
    moduleKey: "action",
    existingHash: "a",
    incomingHash: "b",
    reason: "module-key",
  }],
};

function renderPanel(overrides: {
  packIds?: string[];
  moduleIds?: string[];
  onTogglePack?: () => void;
  onToggleModule?: () => void;
  onImport?: (preview: PromptKnowledgeImportPreview) => Promise<PromptKnowledgeImportCommitResult | null>;
  onDelete?: (id: string) => Promise<void>;
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
      knowledgeModulesByPack={{ "pack-1": [MODULE, CONTRACT] }}
      contractModules={(overrides.packIds ?? []).includes("pack-1") ? [CONTRACT] : []}
      contractTokens={(overrides.packIds ?? []).includes("pack-1") ? 5 : 0}
      knowledgePackIds={overrides.packIds ?? []}
      knowledgeModuleIds={overrides.moduleIds ?? []}
      knowledgeTokens={0}
      onSelectionChange={() => undefined}
      onTextChange={() => undefined}
      onContextTokensChange={() => undefined}
      onToggleKnowledgePack={overrides.onTogglePack ?? (() => undefined)}
      onToggleKnowledgeModule={overrides.onToggleModule ?? (() => undefined)}
      onImportKnowledgePack={overrides.onImport ?? (async () => null)}
      onDeleteKnowledgePack={overrides.onDelete ?? (async () => undefined)}
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
        knowledgeModulesByPack={{ "pack-1": [MODULE, CONTRACT] }}
        contractModules={[CONTRACT]}
        contractTokens={5}
        knowledgePackIds={["pack-1"]}
        knowledgeModuleIds={["module-1"]}
        knowledgeTokens={42}
        onSelectionChange={() => undefined}
        onTextChange={() => undefined}
        onContextTokensChange={() => undefined}
        onToggleKnowledgePack={() => undefined}
        onToggleKnowledgeModule={() => undefined}
        onImportKnowledgePack={async () => null}
        onDeleteKnowledgePack={async () => undefined}
      />,
      { language: "en" },
    );

    expect(screen.getByTestId("writing-layer-tokens").textContent).toContain("49");
  });

  it("shows contract modules as always-on without a checkbox", async () => {
    await renderPanel({ packIds: ["pack-1"] });

    expect(screen.getByTestId("writing-layer-knowledge-contract-contract-1")).toBeTruthy();
    expect(screen.getByText("Read order")).toBeTruthy();
    expect(screen.getByText("Always on")).toBeTruthy();
    expect(screen.queryByTestId("writing-layer-knowledge-module-contract-1")).toBeNull();
  });

  it("previews a chosen directory and confirms the import", async () => {
    const previewPack = vi.fn().mockResolvedValue({ ok: true, data: PREVIEW });
    const onImport = vi.fn().mockResolvedValue({
      packIds: ["pack-2"],
      moduleCount: 1,
      skipped: [],
      conflicts: [],
    });
    installWindowMocks({
      api: {
        promptWritingPresets: { list: vi.fn().mockResolvedValue({ ok: true, data: [] }) },
        promptKnowledge: { previewPack },
      },
      electron: { getPathForFile: () => "C:\\packs\\Skill-Film\\SKILL.md" },
    });

    await renderPanel({ onImport });
    fireEvent.click(screen.getByTestId("writing-layer-knowledge-import"));
    const input = screen.getByTestId("writing-layer-knowledge-directory") as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(["---"], "SKILL.md", { type: "text/markdown" })] },
    });

    await waitFor(() => expect(previewPack).toHaveBeenCalledWith({ rootPath: "C:\\packs\\Skill-Film" }));
    await waitFor(() => expect(screen.getByTestId("knowledge-import-dialog")).toBeTruthy());
    expect(within(screen.getByTestId("knowledge-import-dialog")).getByText("Skill-Film")).toBeTruthy();
    expect(screen.getByTestId("knowledge-import-conflicts").textContent).toContain("module-key");
    expect(screen.getByTestId("knowledge-import-skipped").textContent).toContain("source copy");
    expect(screen.getByTestId("knowledge-import-role-0-0")).toBeTruthy();

    fireEvent.change(screen.getByTestId("knowledge-import-role-0-0"), {
      target: { value: "contract" },
    });
    fireEvent.click(screen.getByTestId("knowledge-import-confirm"));
    await waitFor(() => {
      expect(onImport).toHaveBeenCalledWith(expect.objectContaining({
        packs: [expect.objectContaining({
          modules: [expect.objectContaining({ role: "contract" })],
        })],
      }));
    });
  });

  it("asks the workbench to delete a pack", async () => {
    const onDelete = vi.fn();
    await renderPanel({ packIds: ["pack-1"], onDelete });
    fireEvent.click(screen.getByTestId("writing-layer-knowledge-delete-pack-1"));
    expect(onDelete).toHaveBeenCalledWith("pack-1");
  });
});