import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PromptAssetKindCount, PromptSourceAsset } from "@prompthub/shared/types";
import { PromptAssetLibraryModal } from "../../../src/renderer/components/prompt/PromptAssetLibraryModal";
import { PromptLibraryImportModal } from "../../../src/renderer/components/prompt/PromptLibraryImportModal";
import { renderWithI18n } from "../../helpers/i18n";
import { installWindowMocks } from "../../helpers/window";

function asset(overrides: Partial<PromptSourceAsset> = {}): PromptSourceAsset {
  return {
    id: "ghil:costume:SPR-0001",
    kind: "costume",
    path: "G:\\packs\\costume\\img\\SPR-0001.jpg",
    title: "象牙白针织",
    meta: {},
    createdAt: 1,
    ...overrides,
  };
}

const COUNTS: PromptAssetKindCount[] = [
  { kind: "costume", count: 1407 },
  { kind: "pose", count: 1439 },
];

describe("asset library modal", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    installWindowMocks();
  });

  it("filters by library and marks the materials", async () => {
    const onKindChange = vi.fn();
    const onToggle = vi.fn();
    await renderWithI18n(
      <PromptAssetLibraryModal
        isOpen
        onClose={vi.fn()}
        items={[asset(), asset({ id: "ghil:pose:P001:front", kind: "pose", title: "S形站姿" })]}
        total={2}
        kindCounts={COUNTS}
        kind=""
        query=""
        thumbnails={{ "ghil:costume:SPR-0001": "data:image/jpeg;base64,AAA" }}
        selectedIds={["ghil:costume:SPR-0001"]}
        hasMore={false}
        onKindChange={onKindChange}
        onQueryChange={vi.fn()}
        onToggle={onToggle}
        onClearSelection={vi.fn()}
        onLoadMore={vi.fn()}
        onImport={vi.fn()}
      />,
    );

    expect(screen.getByTestId("asset-library-grid")).toBeInTheDocument();
    expect(screen.getByTestId("asset-library-kind-costume")).toHaveTextContent("1407");
    expect(screen.getByTestId("asset-library-item-ghil:costume:SPR-0001")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("asset-library-item-ghil:pose:P001:front")).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    fireEvent.click(screen.getByTestId("asset-library-kind-pose"));
    expect(onKindChange).toHaveBeenCalledWith("pose");

    fireEvent.click(screen.getByTestId("asset-library-item-ghil:pose:P001:front"));
    expect(onToggle).toHaveBeenCalledWith("ghil:pose:P001:front");
  });

  it("shows the thumbnail the main process handed out", async () => {
    await renderWithI18n(
      <PromptAssetLibraryModal
        isOpen
        onClose={vi.fn()}
        items={[asset()]}
        total={1}
        kindCounts={COUNTS}
        kind=""
        query=""
        thumbnails={{ "ghil:costume:SPR-0001": "data:image/jpeg;base64,AAA" }}
        selectedIds={[]}
        hasMore={false}
        onKindChange={vi.fn()}
        onQueryChange={vi.fn()}
        onToggle={vi.fn()}
        onClearSelection={vi.fn()}
        onLoadMore={vi.fn()}
        onImport={vi.fn()}
      />,
    );

    const image = screen.getByAltText("象牙白针织");
    expect(image).toHaveAttribute("src", "data:image/jpeg;base64,AAA");
  });
});

describe("library import modal", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("reads the preview and writes the import for the color cards", async () => {
    const preview = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        items: [{ id: "a" }],
        skipped: [{ path: "C:\\cards\\x", reason: "palette.json is missing" }],
        conflicts: [],
        categories: [{ name: "黑色悬疑", count: 1 }],
      },
    });
    const importLibrary = vi.fn().mockResolvedValue({
      ok: true,
      data: { itemIds: ["a"], skipped: [], conflicts: [] },
    });
    installWindowMocks({
      api: { promptReference: { preview, importLibrary } },
      electron: { selectImportFolders: vi.fn().mockResolvedValue(["C:\\cards"]) },
    });
    const onImported = vi.fn();

    await renderWithI18n(
      <PromptLibraryImportModal
        mode="reference"
        isOpen
        onClose={vi.fn()}
        onImported={onImported}
      />,
    );

    fireEvent.click(screen.getByTestId("library-import-add-source"));
    await waitFor(() => expect(screen.getByTestId("library-import-sources")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("library-import-preview"));
    await waitFor(() => expect(preview).toHaveBeenCalledWith({ roots: ["C:\\cards"] }));
    await waitFor(() =>
      expect(screen.getByTestId("library-import-item-count")).toHaveTextContent("1"),
    );
    expect(screen.getByTestId("library-import-preview-summary")).toHaveTextContent(
      "palette.json is missing",
    );

    fireEvent.click(screen.getByTestId("library-import-commit"));
    await waitFor(() => expect(importLibrary).toHaveBeenCalledWith({ roots: ["C:\\cards"] }));
    await waitFor(() => expect(onImported).toHaveBeenCalled());
  });

  it("previews the picture library and reports its conflicts", async () => {
    const preview = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        items: [{ id: "a" }, { id: "b" }],
        skipped: [],
        conflicts: [{ id: "ghil:hair:h-2", kind: "hair", reason: "missing-source-relation", detail: "portrait p-2 is not in the library" }],
        counts: { costume: 2 },
      },
    });
    installWindowMocks({
      api: { promptAsset: { preview } },
      electron: { selectImportFolders: vi.fn().mockResolvedValue(["C:\\ghil"]) },
    });

    await renderWithI18n(
      <PromptLibraryImportModal
        mode="asset"
        isOpen
        onClose={vi.fn()}
        onImported={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("library-import-add-source"));
    await waitFor(() => expect(screen.getByTestId("library-import-sources")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("library-import-preview"));

    await waitFor(() => expect(preview).toHaveBeenCalledWith({ rootPath: "C:\\ghil" }));
    await waitFor(() =>
      expect(screen.getByTestId("library-import-preview-summary")).toHaveTextContent(
        "missing-source-relation",
      ),
    );
  });
});
