import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "../../helpers/i18n";
import { PromptAssetGallery } from "../../../src/renderer/components/prompt/PromptAssetGallery";
import type { PromptSourceAsset } from "@prompthub/shared/types";

const costume = (id: string, title: string, category: string): PromptSourceAsset => ({
  id: `ghil:costume:${id}`,
  kind: "costume",
  path: `G:/lib/costume/${id}.png`,
  title,
  meta: { category, keywords: ["rain"] },
  createdAt: 0,
});

const items = [costume("1", "黑色长风衣", "外套"), costume("2", "军绿雨披", "外套")];

const list = vi.fn(async (query: { query?: string; kind?: string; offset?: number }) => ({
  ok: true as const,
  data: {
    items: query.query ? items.filter((item) => item.title?.includes(query.query)) : items,
    total: query.query ? 1 : 2,
  },
}));
const countByKind = vi.fn(async () => ({
  ok: true as const,
  data: [
    { kind: "costume", count: 2 },
    { kind: "hair", count: 0 },
  ],
}));
const thumbnail = vi.fn(async () => ({
  ok: true as const,
  data: "data:image/jpeg;base64,AAAA",
}));
const defaultRoot = vi.fn(async () => ({ ok: true as const, data: null }));
const importLibrary = vi.fn(async () => ({
  ok: true as const,
  data: { root: "", counts: {}, inserted: 0, updated: 0, skipped: 0, conflicts: 0 },
}));

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, "api", {
    configurable: true,
    value: { promptAsset: { list, countByKind, thumbnail, defaultRoot, importLibrary } },
  });
});

describe("PromptAssetGallery", () => {
  it("shows library counts and one card per asset", async () => {
    await renderWithI18n(<PromptAssetGallery />, { language: "en" });
    await waitFor(() => expect(list).toHaveBeenCalled());
    expect(await screen.findByText("黑色长风衣")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("orchestrator-asset-kind-all")).toHaveTextContent("2"),
    );
    expect(screen.getByTestId("orchestrator-asset-kind-costume")).toHaveTextContent("2");
    expect(screen.getByTestId("orchestrator-asset-range")).toHaveTextContent("1–2 / 2");
  });

  it("opens a read-only detail with metadata and source path", async () => {
    await renderWithI18n(<PromptAssetGallery />, { language: "en" });
    fireEvent.click(await screen.findByTestId("orchestrator-asset-card-ghil:costume:1"));
    const detail = await screen.findByTestId("orchestrator-asset-detail");
    expect(within(detail).getByText("ghil:costume:1")).toBeInTheDocument();
    expect(within(detail).getByText("G:/lib/costume/1.png")).toBeInTheDocument();
    expect(within(detail).getByText("keywords")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("orchestrator-asset-detail-close"));
    expect(screen.queryByTestId("orchestrator-asset-detail")).toBeNull();
  });

  it("sends the search term to the query and shows the filtered total", async () => {
    await renderWithI18n(<PromptAssetGallery />, { language: "en" });
    fireEvent.change(screen.getByTestId("orchestrator-asset-search"), {
      target: { value: "军绿" },
    });
    await waitFor(
      () => expect(list).toHaveBeenCalledWith(expect.objectContaining({ query: "军绿" })),
      { timeout: 2000 },
    );
    await waitFor(() => expect(screen.queryByText("黑色长风衣")).toBeNull());
    expect(screen.getByText("军绿雨披")).toBeInTheDocument();
  });

  it("shows an empty state instead of a blank grid", async () => {
    list.mockResolvedValueOnce({ ok: true as const, data: { items: [], total: 0 } });
    await renderWithI18n(<PromptAssetGallery />, { language: "en" });
    expect(await screen.findByTestId("orchestrator-asset-empty")).toBeInTheDocument();
  });

  it("indexes the default library once when the index is empty", async () => {
    defaultRoot.mockResolvedValueOnce({ ok: true as const, data: "G:/library/GHIL" });
    countByKind
      .mockResolvedValueOnce({ ok: true as const, data: [] })
      .mockResolvedValue({ ok: true as const, data: [{ kind: "costume", count: 2 }] });
    importLibrary.mockResolvedValueOnce({
      ok: true as const,
      data: {
        root: "G:/library/GHIL",
        counts: { costume: 2 },
        inserted: 2,
        updated: 0,
        skipped: 0,
        conflicts: 0,
      },
    });
    await renderWithI18n(<PromptAssetGallery />, { language: "en" });
    await waitFor(() => expect(importLibrary).toHaveBeenCalledTimes(1));
    expect(importLibrary).toHaveBeenCalledWith(undefined);
    await waitFor(() =>
      expect(screen.getByTestId("orchestrator-asset-root")).toHaveTextContent("2"),
    );
    await waitFor(() =>
      expect(screen.getByTestId("orchestrator-asset-kind-costume")).toHaveTextContent("2"),
    );
  });
});