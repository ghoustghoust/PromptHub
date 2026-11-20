import { useEffect, useMemo, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  PromptTermDomain,
  PromptVocabularyBrowseResult,
  PromptVocabularySearchItem,
} from "@prompthub/shared/types";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Modal } from "../ui/Modal";
import { PromptTermChip } from "./PromptTermChip";
import { CATEGORY_ORDER } from "./prompt-vocabulary-categories";

type DomainFilter = "all" | PromptTermDomain;
type TranslationFilter = "all" | "missing" | "translated";

interface PromptVocabularyBrowserModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialCategory: string;
  initialSubcategory: string | null;
  initialDomain: DomainFilter;
  series: string;
  selectedTerms: PromptVocabularySearchItem[];
  onAdd: (term: PromptVocabularySearchItem) => void;
  onRemove: (id: string) => void;
}

export function PromptVocabularyBrowserModal({
  isOpen,
  onClose,
  initialCategory,
  initialSubcategory,
  initialDomain,
  series,
  selectedTerms,
  onAdd,
  onRemove,
}: PromptVocabularyBrowserModalProps) {
  const { t } = useTranslation();
  const [activeCategory, setActiveCategory] = useState(initialCategory);
  const [activeSubcategory, setActiveSubcategory] = useState<string | null>(initialSubcategory);
  const [domain, setDomain] = useState<DomainFilter>(initialDomain);
  const [query, setQuery] = useState("");
  const [allFields, setAllFields] = useState(false);
  const [translation, setTranslation] = useState<TranslationFilter>("all");
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState(60);
  const [result, setResult] = useState<PromptVocabularyBrowseResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    setActiveCategory(initialCategory);
    setActiveSubcategory(initialSubcategory);
    setDomain(initialDomain);
    setQuery("");
    setAllFields(false);
    setTranslation("all");
    setOffset(0);
    setLimit(60);
    setResult(null);
    setError("");
  }, [isOpen, initialCategory, initialDomain, initialSubcategory]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      const domainFilter = domain === "all" ? {} : { domain };
      void window.api.promptOrchestrator.browseTerms({
        category: allFields ? undefined : activeCategory,
        subcategory: !allFields && activeSubcategory !== null ? activeSubcategory : undefined,
        query: query.trim() || undefined,
        series: series || undefined,
        ...domainFilter,
        translation,
        limit,
        offset,
      }).then((reply) => {
        if (cancelled) return;
        if (reply.ok === true) setResult(reply.data);
        else setError(reply.error.message);
      }).catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      }).finally(() => {
        if (!cancelled) setLoading(false);
      });
    }, 160);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeCategory, activeSubcategory, allFields, domain, isOpen, limit, offset, query, series, translation]);

  const selectedIds = useMemo(
    () => new Set(selectedTerms.map((term) => term.id)),
    [selectedTerms],
  );
  const categoryCounts = useMemo(
    () => new Map((result?.categories ?? []).map((row) => [row.category, row.count])),
    [result],
  );
  const allFieldsCount = (result?.categories ?? []).reduce((sum, row) => sum + row.count, 0);
  const allSubcategoriesCount = (result?.subcategories ?? []).reduce((sum, row) => sum + row.count, 0);
  const pageCount = Math.max(1, Math.ceil((result?.total ?? 0) / limit));
  const page = Math.floor(offset / limit) + 1;

  function chooseCategory(category: string): void {
    setActiveCategory(category);
    setActiveSubcategory(null);
    setAllFields(false);
    setOffset(0);
  }

  function chooseAllFields(): void {
    setAllFields(true);
    setActiveSubcategory(null);
    setOffset(0);
  }

  function jumpToPage(value: number): void {
    if (!Number.isInteger(value)) return;
    const next = Math.min(pageCount, Math.max(1, value));
    setOffset((next - 1) * limit);
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("orchestrator.browser.title")}
      subtitle={t("orchestrator.browser.subtitle")}
      size="fullscreen"
      contentClassName="flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      <div className="shrink-0 space-y-2 border-b border-border px-4 py-3">
        <Input
          aria-label={t("orchestrator.browser.search")}
          placeholder={t("orchestrator.browser.searchPlaceholder")}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setAllFields(true);
            setActiveSubcategory(null);
            setOffset(0);
          }}
          variant="outlined"
        />
        <div className="flex flex-wrap items-center gap-1.5">
          {(["all", "shared", "real", "anime", "3d"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={domain === value}
              onClick={() => {
                setDomain(value);
                setOffset(0);
              }}
              className={`rounded-full border px-2.5 py-1 text-[11px] ${
                domain === value
                  ? "border-primary/50 bg-primary/15 text-primary"
                  : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              {t(`orchestrator.picker.domain.${value}`)}
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
          {(["all", "missing", "translated"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={translation === value}
              onClick={() => {
                setTranslation(value);
                setOffset(0);
              }}
              className={`rounded-full border px-2.5 py-1 text-[11px] ${
                translation === value
                  ? "border-primary/50 bg-primary/15 text-primary"
                  : "border-border text-muted-foreground hover:bg-muted"
              }`}
              data-testid={`vocabulary-translation-${value}`}
            >
              {t(`orchestrator.browser.translation.${value}`, {
                count: value === "missing" ? result?.missingTranslation ?? 0 : undefined,
              })}
            </button>
          ))}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[140px_200px_minmax(0,1fr)] max-md:grid-cols-[116px_156px_minmax(0,1fr)]">
        <nav
          aria-label={t("orchestrator.picker.fields")}
          className="flex min-h-0 flex-col gap-1 overflow-y-auto border-r border-border p-2"
        >
          <button
            type="button"
            aria-pressed={allFields}
            onClick={chooseAllFields}
            className={`flex shrink-0 items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-xs ${
              allFields ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"
            }`}
            data-testid="vocabulary-category-all"
          >
            <span>{t("orchestrator.browser.allFields")}</span>
            <span className="text-[10px] tabular-nums opacity-70">{allFieldsCount}</span>
          </button>
          {CATEGORY_ORDER.map((category) => {
            const active = !allFields && activeCategory === category;
            return (
              <button
                key={category}
                type="button"
                aria-pressed={active}
                onClick={() => chooseCategory(category)}
                className={`flex shrink-0 items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-xs ${
                  active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"
                }`}
                data-testid={`vocabulary-category-${category}`}
              >
                <span>{t(`orchestrator.categories.${category}`, category)}</span>
                <span className="text-[10px] tabular-nums opacity-70">
                  {categoryCounts.get(category) ?? 0}
                </span>
              </button>
            );
          })}
        </nav>

        <nav
          aria-label={t("orchestrator.browser.subcategories")}
          className="flex min-h-0 flex-col gap-1 overflow-y-auto border-r border-border p-2"
          data-testid="vocabulary-subcategories"
        >
          {allFields ? (
            <p className="p-2 text-[11px] leading-relaxed text-muted-foreground">
              {t("orchestrator.browser.allFieldsHint")}
            </p>
          ) : (
            <>
              <button
                type="button"
                aria-pressed={activeSubcategory === null}
                onClick={() => {
                  setActiveSubcategory(null);
                  setOffset(0);
                }}
                className={`flex shrink-0 items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-xs ${
                  activeSubcategory === null ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted"
                }`}
              >
                <span>{t("orchestrator.picker.allSubcategories")}</span>
                <span className="text-[10px] tabular-nums opacity-70">{allSubcategoriesCount}</span>
              </button>
              {(result?.subcategories ?? []).map((row) => {
                const value = row.subcategory ?? "";
                const active = activeSubcategory === value;
                return (
                  <button
                    key={value || "__uncategorized__"}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      setActiveSubcategory(value);
                      setOffset(0);
                    }}
                    className={`flex shrink-0 items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-xs ${
                      active ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted"
                    }`}
                    data-testid={`vocabulary-subcategory-${value || "uncategorized"}`}
                  >
                    <span className="whitespace-normal break-words">
                      {value || t("orchestrator.picker.uncategorized")}
                    </span>
                    <span className="shrink-0 text-[10px] tabular-nums opacity-70">{row.count}</span>
                  </button>
                );
              })}
            </>
          )}
        </nav>

        <section className="flex min-h-0 min-w-0 flex-col" aria-label={t("orchestrator.picker.terms")}>
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-3 py-2.5">
            <div className="min-w-0">
              <h3 className="truncate text-xs font-medium">
                {allFields
                  ? t("orchestrator.browser.allFields")
                  : t(`orchestrator.categories.${activeCategory}`, activeCategory)}
              </h3>
              <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground" data-testid="vocabulary-total">
                {t("orchestrator.browser.total", { count: result?.total ?? 0 })}
              </p>
            </div>
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {t("orchestrator.picker.selected", { count: selectedTerms.length })}
            </span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {loading && <p className="p-2 text-[11px] text-muted-foreground">{t("common.loading")}</p>}
            {error && <p role="alert" className="p-2 text-xs text-destructive">{error}</p>}
            {!loading && !error && (result?.items.length ?? 0) === 0 && (
              <p className="p-3 text-xs text-muted-foreground">{t("orchestrator.browser.empty")}</p>
            )}
            <div className="grid grid-cols-1 gap-1.5 xl:grid-cols-2 2xl:grid-cols-3">
              {(result?.items ?? []).map((term) => {
                const selected = selectedIds.has(term.id);
                return (
                  <PromptTermChip
                    key={term.id}
                    term={term}
                    selected={selected}
                    hint={allFields ? `${t(`orchestrator.categories.${term.category}`, term.category)} / ${term.subcategory ?? t("orchestrator.picker.uncategorized")}` : term.subcategory}
                    testId={`term-chip-${term.id}`}
                    onToggle={() => (selected ? onRemove(term.id) : onAdd(term))}
                  />
                );
              })}
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2">
            <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
              {t("orchestrator.browser.pageSize")}
              <select
                value={limit}
                onChange={(event) => {
                  setLimit(Number(event.target.value));
                  setOffset(0);
                }}
                className="h-7 rounded border border-border bg-background px-1.5 text-xs text-foreground"
              >
                {[60, 120, 200].map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="ghost"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - limit))}
                aria-label={t("orchestrator.browser.previous")}
                data-testid="vocabulary-previous"
              >
                <ChevronLeftIcon className="h-4 w-4" aria-hidden="true" />
              </Button>
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {t("orchestrator.browser.pageStatus", { page, pageCount })}
              </span>
              <input
                key={`${page}-${pageCount}`}
                type="number"
                min={1}
                max={pageCount}
                defaultValue={page}
                aria-label={t("orchestrator.browser.pageNumber")}
                onBlur={(event) => jumpToPage(Number(event.target.value))}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
                className="h-7 w-16 rounded border border-border bg-background px-1.5 text-center text-xs"
              />
              <Button
                size="sm"
                variant="ghost"
                disabled={offset + limit >= (result?.total ?? 0)}
                onClick={() => setOffset(offset + limit)}
                aria-label={t("orchestrator.browser.next")}
                data-testid="vocabulary-next"
              >
                <ChevronRightIcon className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        </section>
      </div>
    </Modal>
  );
}
