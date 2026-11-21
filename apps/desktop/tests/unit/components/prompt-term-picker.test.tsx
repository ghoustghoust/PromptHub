import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PromptVocabularySearchItem } from "@prompthub/shared/types";
import { PromptTermPicker } from "../../../src/renderer/components/prompt/PromptTermPicker";
import { renderWithI18n } from "../../helpers/i18n";

function term(overrides: Partial<PromptVocabularySearchItem>): PromptVocabularySearchItem {
  return {
    id: "id",
    category: "style",
    subcategory: null,
    en: "term",
    zh: null,
    series: null,
    template: null,
    validationStatus: "validated",
    ...overrides,
  };
}

const byCategory: Record<string, PromptVocabularySearchItem[]> = {
  style: [
    term({ id: "s1", category: "style", subcategory: "光效", en: "cinematic lighting", zh: "电影感光效" }),
    term({ id: "s2", category: "style", subcategory: "质感", en: "film grain" }),
  ],
  clothing: [term({ id: "c1", category: "clothing", en: "linen shirt" })],
};

function mockBrowseTerms(catalog: Record<string, PromptVocabularySearchItem[]>) {
  return vi.fn(async (input: { category?: string; subcategory?: string }) => {
    const all = catalog[input.category ?? ""] ?? [];
    const items = input.subcategory === undefined
      ? all
      : all.filter((item) => (item.subcategory ?? "") === input.subcategory);
    const counts = new Map<string, number>();
    for (const item of all) {
      const key = item.subcategory ?? "";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return {
      ok: true as const,
      data: {
        items,
        total: items.length,
        offset: 0,
        limit: 60,
        categories: Object.entries(catalog).map(([category, rows]) => ({ category, count: rows.length })),
        subcategories: [...counts.entries()].map(([subcategory, count]) => ({
          subcategory: subcategory || null,
          count,
        })),
        missingTranslation: all.filter((item) => !item.zh).length,
      },
    };
  });
}

beforeEach(() => {
  Object.assign(window, {
    api: {
      promptOrchestrator: {
        searchTerms: vi.fn(async (input: { category?: string; query?: string }) => ({
          ok: true as const,
          data: input.category ? (byCategory[input.category] ?? []) : [],
        })),
        browseTerms: mockBrowseTerms(byCategory),
        resolveTerms: vi.fn(async () => ({ ok: true as const, data: [] })),
      },
    },
  });
});

describe("PromptTermPicker", () => {
  it("shows one field at a time and switches fields without losing the picker", async () => {
    await renderWithI18n(
      <PromptTermPicker
        series=""
        seriesOptions={[]}
        selectedTerms={[]}
        onSeriesChange={() => undefined}
        onAdd={() => undefined}
        onRemove={() => undefined}
        onClear={() => undefined}
      />,
    );

    await waitFor(() => expect(screen.getByText("cinematic lighting")).toBeTruthy());
    expect(screen.queryByText("linen shirt")).toBeNull();

    fireEvent.click(screen.getByTestId("term-category-clothing"));
    await waitFor(() => expect(screen.getByText("linen shirt")).toBeTruthy());
    expect(screen.queryByText("cinematic lighting")).toBeNull();
    expect(screen.getByTestId("term-picker")).toBeTruthy();
  });

  it("uses subcategories as real filters instead of row labels", async () => {
    await renderWithI18n(
      <PromptTermPicker
        series=""
        seriesOptions={[]}
        selectedTerms={[]}
        onSeriesChange={() => undefined}
        onAdd={() => undefined}
        onRemove={() => undefined}
        onClear={() => undefined}
      />,
    );

    await waitFor(() => expect(screen.getByTestId("term-chip-s1")).toBeTruthy());
    fireEvent.click(screen.getByTestId("term-subcategory-光效"));

    await waitFor(() => {
      expect(screen.getByTestId("term-chip-s1")).toBeTruthy();
      expect(screen.queryByTestId("term-chip-s2")).toBeNull();
    });
  });

  it("locks on click and unlocks when the chip is already selected", async () => {
    const onAdd = vi.fn();
    const onRemove = vi.fn();
    await renderWithI18n(
      <PromptTermPicker
        series=""
        seriesOptions={[]}
        selectedTerms={[term({ id: "s1", category: "style", en: "cinematic lighting" })]}
        onSeriesChange={() => undefined}
        onAdd={onAdd}
        onRemove={onRemove}
        onClear={() => undefined}
      />,
    );

    await waitFor(() => expect(screen.getByTestId("term-chip-s2")).toBeTruthy());

    fireEvent.click(screen.getByTestId("term-chip-s1"));
    expect(onRemove).toHaveBeenCalledWith("s1");

    fireEvent.click(screen.getByTestId("term-chip-s2"));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ id: "s2" }));
  });

  it("narrows the pool by subject domain and exposes NSFW as its own field", async () => {
    const browseTerms = mockBrowseTerms({});
    Object.assign(window, {
      api: {
        promptOrchestrator: {
          searchTerms: vi.fn(async () => ({ ok: true as const, data: [] })),
          browseTerms,
          resolveTerms: vi.fn(async () => ({ ok: true as const, data: [] })),
        },
      },
    });
    await renderWithI18n(
      <PromptTermPicker
        series=""
        seriesOptions={[]}
        selectedTerms={[]}
        onSeriesChange={() => undefined}
        onAdd={() => undefined}
        onRemove={() => undefined}
        onClear={() => undefined}
      />,
    );

    expect(screen.getByTestId("term-category-nsfw")).toBeTruthy();
    fireEvent.click(screen.getByTestId("term-picker-domain-real"));
    await waitFor(() =>
      expect(browseTerms).toHaveBeenCalledWith(expect.objectContaining({ domain: "real" })),
    );
  });

  it("shows the locked count and clears the whole selection", async () => {
    const onClear = vi.fn();
    await renderWithI18n(
      <PromptTermPicker
        series=""
        seriesOptions={[]}
        selectedTerms={[
          term({ id: "s1", category: "style", en: "cinematic lighting" }),
          term({ id: "c1", category: "clothing", en: "linen shirt" }),
        ]}
        onSeriesChange={() => undefined}
        onAdd={() => undefined}
        onRemove={() => undefined}
        onClear={onClear}
      />,
    );

    await waitFor(() => expect(screen.getByTestId("term-picker-selected")).toBeTruthy());
    expect(screen.getByTestId("term-picker-count").textContent).toContain("2");

    fireEvent.click(screen.getByTestId("term-picker-clear"));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("switches a picked term between locked, recommended, reference and excluded", async () => {
    const onStateChange = vi.fn();
    await renderWithI18n(
      <PromptTermPicker
        series=""
        seriesOptions={[]}
        selectedTerms={[
          { ...term({ id: "s1", category: "style", en: "cinematic lighting" }), state: "recommended" },
        ]}
        onSeriesChange={() => undefined}
        onAdd={() => undefined}
        onRemove={() => undefined}
        onStateChange={onStateChange}
        onClear={() => undefined}
      />,
    );

    await waitFor(() => expect(screen.getByTestId("term-state-s1")).toBeTruthy());
    const select = screen.getByTestId("term-state-s1") as HTMLSelectElement;
    expect(select.value).toBe("recommended");
    expect([...select.options].map((option) => option.value)).toEqual([
      "locked",
      "recommended",
      "reference",
      "excluded",
    ]);

    fireEvent.change(select, { target: { value: "reference" } });
    expect(onStateChange).toHaveBeenCalledWith("s1", "reference");
  });
});

describe("PromptTermPicker collections", () => {
  const stylePool = [
    term({ id: "cel", category: "style", subcategory: "质量与风格", en: "cel shading", zh: "赛璐璐阴影" }),
    term({ id: "anime80", category: "style", subcategory: "艺术风格", en: "1980s anime", zh: "80动画" }),
    term({ id: "celluloid", category: "style", subcategory: "总体画风", en: "celluloid style", zh: "赛璐璐风" }),
  ];

  function mockCollections(resolved: PromptVocabularySearchItem[]) {
    Object.assign(window, {
      api: {
        promptOrchestrator: {
          searchTerms: vi.fn(async (input: { category?: string }) => ({
            ok: true as const,
            data: input.category === "style" ? stylePool : [],
          })),
          browseTerms: mockBrowseTerms({ style: stylePool }),
          resolveTerms: vi.fn(async () => ({ ok: true as const, data: resolved })),
        },
      },
    });
  }

  it("only exposes packs that resolve to real subcategory terms, and locks them", async () => {
    mockCollections([]);
    const onAdd = vi.fn();
    await renderWithI18n(
      <PromptTermPicker
        series=""
        seriesOptions={[]}
        selectedTerms={[]}
        onSeriesChange={() => undefined}
        onAdd={onAdd}
        onRemove={() => undefined}
        onClear={() => undefined}
      />,
    );

    await waitFor(() => expect(screen.getByTestId("term-picker-mode-packs")).toBeTruthy());
    expect(screen.queryByTestId("term-picker-mode-presets")).toBeNull();

    fireEvent.click(screen.getByTestId("term-picker-mode-packs"));
    await waitFor(() => expect(screen.getByTestId("term-pack-anime-cel")).toBeTruthy());
    // Packs with fewer than three real terms are not rendered at all.
    expect(screen.queryByTestId("term-pack-thick-paint")).toBeNull();

    fireEvent.click(screen.getByTestId("term-chip-cel"));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ id: "cel" }));
  });

  it("hides collection modes when nothing resolves instead of showing empty entries", async () => {
    Object.assign(window, {
      api: {
        promptOrchestrator: {
          searchTerms: vi.fn(async () => ({ ok: true as const, data: [] })),
          browseTerms: mockBrowseTerms({}),
          resolveTerms: vi.fn(async () => ({
            ok: true as const,
            data: ["1girl", "solo", "smile"].map((en) => term({ id: en, category: "character", en })),
          })),
        },
      },
    });
    await renderWithI18n(
      <PromptTermPicker
        series=""
        seriesOptions={[]}
        selectedTerms={[]}
        onSeriesChange={() => undefined}
        onAdd={() => undefined}
        onRemove={() => undefined}
        onClear={() => undefined}
      />,
    );

    await waitFor(() => expect(screen.getByTestId("term-picker-fields")).toBeTruthy());
    await waitFor(() => expect(screen.queryByTestId("term-picker-modes")).toBeNull());
  });

  it("loads resolved preset terms and reports honest hit counts", async () => {
    const resolved = [
      "1girl", "solo", "full body", "from front", "standing", "simple background",
      "white background", "looking at viewer",
    ].map((en) => term({ id: en, category: "character", en }));
    mockCollections(resolved);
    const onAdd = vi.fn();
    await renderWithI18n(
      <PromptTermPicker
        series=""
        seriesOptions={[]}
        selectedTerms={[]}
        onSeriesChange={() => undefined}
        onAdd={onAdd}
        onRemove={() => undefined}
        onClear={() => undefined}
      />,
    );

    await waitFor(() => expect(screen.getByTestId("term-picker-mode-presets")).toBeTruthy());
    fireEvent.click(screen.getByTestId("term-picker-mode-presets"));

    await waitFor(() => expect(screen.getByTestId("term-preset-full-body")).toBeTruthy());
    expect(screen.getByTestId("term-preset-hits").textContent).toContain("8/10");

    fireEvent.click(screen.getByTestId("term-preset-load"));
    expect(onAdd).toHaveBeenCalledTimes(8);
  });
});