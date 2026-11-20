import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PromptVocabularySearchItem } from "@prompthub/shared/types";
import { PromptVocabularyBrowserModal } from "../../../src/renderer/components/prompt/PromptVocabularyBrowserModal";
import { PromptTermChip } from "../../../src/renderer/components/prompt/PromptTermChip";
import { renderWithI18n } from "../../helpers/i18n";

function term(overrides: Partial<PromptVocabularySearchItem>): PromptVocabularySearchItem {
  return {
    id: "term-1",
    category: "character",
    subcategory: "主角",
    en: "untranslated phrase",
    zh: null,
    series: null,
    template: null,
    domain: "anime",
    validationStatus: "unvalidated",
    ...overrides,
  };
}

const browseTerms = vi.fn(async () => ({
  ok: true as const,
  data: {
    items: [term({ id: "character-5001", en: "term beyond old cap" })],
    total: 6003,
    offset: 0,
    limit: 60,
    categories: [
      { category: "character", count: 6003 },
      { category: "style", count: 1549 },
    ],
    subcategories: [
      { subcategory: "主角", count: 5001 },
      { subcategory: "其他", count: 1002 },
    ],
    missingTranslation: 643,
  },
}));

beforeEach(() => {
  browseTerms.mockClear();
  Object.assign(window, {
    api: { promptOrchestrator: { browseTerms } },
  });
});

function renderBrowser(onAdd = vi.fn()) {
  return renderWithI18n(
    <PromptVocabularyBrowserModal
      isOpen
      onClose={() => undefined}
      initialCategory="character"
      initialSubcategory={null}
      initialDomain="all"
      series=""
      selectedTerms={[]}
      onAdd={onAdd}
      onRemove={() => undefined}
    />,
  );
}

describe("PromptVocabularyBrowserModal", () => {
  it("shows exact totals and terms beyond the old 5000-row cap", async () => {
    const onAdd = vi.fn();
    await renderBrowser(onAdd);

    await waitFor(() => expect(screen.getByTestId("vocabulary-total").textContent).toContain("6003"));
    expect(screen.getByText("term beyond old cap")).toBeTruthy();
    expect(screen.getByTestId("vocabulary-category-character").textContent).toContain("6003");
    expect(screen.getByTestId("vocabulary-subcategory-主角").textContent).toContain("5001");

    fireEvent.click(screen.getByTestId("term-chip-character-5001"));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ id: "character-5001" }));
  });

  it("queries subcategories, missing translations and later pages from SQLite", async () => {
    await renderBrowser();
    await waitFor(() => expect(screen.getByTestId("vocabulary-subcategory-其他")).toBeTruthy());

    fireEvent.click(screen.getByTestId("vocabulary-subcategory-其他"));
    await waitFor(() => expect(browseTerms).toHaveBeenLastCalledWith(expect.objectContaining({
      subcategory: "其他",
      offset: 0,
    })));

    fireEvent.click(screen.getByTestId("vocabulary-translation-missing"));
    await waitFor(() => expect(browseTerms).toHaveBeenLastCalledWith(expect.objectContaining({
      translation: "missing",
      offset: 0,
    })));

    fireEvent.click(screen.getByTestId("vocabulary-next"));
    await waitFor(() => expect(browseTerms).toHaveBeenLastCalledWith(expect.objectContaining({
      offset: 60,
    })));
  });
});

describe("PromptTermChip translation states", () => {
  it("distinguishes missing translations, preserved names and Chinese source text", async () => {
    await renderWithI18n(
      <div>
        <PromptTermChip term={term({ id: "plain" })} selected={false} onToggle={() => undefined} testId="plain" />
        <PromptTermChip
          term={term({ id: "artist", category: "artist", en: "artist_handle" })}
          selected={false}
          onToggle={() => undefined}
          testId="artist"
        />
        <PromptTermChip
          term={term({ id: "zh", en: "纯色背景" })}
          selected={false}
          onToggle={() => undefined}
          testId="zh"
        />
      </div>,
    );

    expect(screen.getByTestId("plain").textContent).toContain("No Chinese yet");
    expect(screen.getByTestId("artist").textContent).toContain("Original name");
    expect(screen.getByTestId("artist").textContent).not.toContain("No Chinese yet");
    expect(screen.getByTestId("zh").textContent).toContain("Chinese source text");
  });
});
