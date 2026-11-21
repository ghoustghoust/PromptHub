import { useEffect, useMemo, useState } from "react";
import {
  BookOpenIcon,
  Maximize2Icon,
  Minimize2Icon,
  XIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  PromptTermDomain,
  PromptVocabularyBrowseResult,
  PromptVocabularySearchItem,
} from "@prompthub/shared/types";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { formatTermLabel, PromptTermChip } from "./PromptTermChip";
import { PromptVocabularyPackBrowser } from "./PromptVocabularyPackBrowser";
import { PromptVocabularyPresetBrowser } from "./PromptVocabularyPresetBrowser";
import { PromptVocabularyBrowserModal } from "./PromptVocabularyBrowserModal";
import { CATEGORY_ORDER } from "./prompt-vocabulary-categories";
import {
  MIN_PACK_TERMS,
  PACK_CATEGORIES,
  VOCABULARY_PACKS,
  VOCABULARY_PRESETS,
  resolvePackTerms,
  resolvePresets,
} from "./prompt-vocabulary-collections";

type PickerTermState = "locked" | "recommended" | "reference" | "excluded";

type PickerSelectedTerm = PromptVocabularySearchItem & { state?: PickerTermState };

interface PromptTermPickerProps {
  series: string;
  seriesOptions: readonly string[];
  selectedTerms: PickerSelectedTerm[];
  onSeriesChange: (value: string) => void;
  onAdd: (term: PromptVocabularySearchItem) => void;
  onRemove: (id: string) => void;
  onStateChange?: (id: string, state: PickerTermState) => void;
  onClear: () => void;
  expanded?: boolean;
  onToggleExpanded?: () => void;
}

const TERM_STATES: readonly PickerTermState[] = [
  "locked",
  "recommended",
  "reference",
  "excluded",
];

const STATE_CHIP: Record<PickerTermState, string> = {
  locked: "border-primary/40 bg-primary/10 text-primary",
  recommended: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  reference: "border-border bg-muted text-muted-foreground",
  excluded: "border-border bg-transparent text-muted-foreground line-through",
};

const POOL_LIMIT = 5000;
const SEARCH_LIMIT = 200;
/** Rendered rows per field before "show more"; the fetch already holds everything. */
const PAGE_SIZE = 60;
const WIDE_BODY =
  "[@container(min-width:900px)]:grid-cols-[140px_168px_minmax(0,1fr)] [@container(min-width:900px)]:grid-rows-1";
const WIDE_NAV =
  "[@container(min-width:900px)]:flex-col [@container(min-width:900px)]:overflow-x-hidden [@container(min-width:900px)]:overflow-y-auto [@container(min-width:900px)]:border-b-0 [@container(min-width:900px)]:border-r";
const WIDE_CATEGORY_BUTTON =
  "[@container(min-width:900px)]:w-full [@container(min-width:900px)]:shrink";
const WIDE_SUBCATEGORY_BUTTON = "[@container(min-width:900px)]:w-full";

interface Pool {
  category: string;
  terms: PromptVocabularySearchItem[];
}

export function PromptTermPicker({
  series,
  seriesOptions,
  selectedTerms,
  onSeriesChange,
  onAdd,
  onRemove,
  onStateChange,
  onClear,
  expanded = false,
  onToggleExpanded,
}: PromptTermPickerProps) {
  const { t } = useTranslation();
  const [pools, setPools] = useState<Pool[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>("style");
  const [activeSubcategory, setActiveSubcategory] = useState<string | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [shownByCategory, setShownByCategory] = useState<Record<string, number>>({});
  const [globalQuery, setGlobalQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"fields" | "packs" | "presets">("fields");
  const [domain, setDomain] = useState<"all" | PromptTermDomain>("all");
  const [packCatalog, setPackCatalog] = useState<PromptVocabularySearchItem[]>([]);
  const [presetRows, setPresetRows] = useState<PromptVocabularySearchItem[]>([]);
  const [browseResult, setBrowseResult] = useState<PromptVocabularyBrowseResult | null>(null);
  const [browserOpen, setBrowserOpen] = useState(false);

  const selectedIds = useMemo(
    () => new Set(selectedTerms.map((term) => term.id)),
    [selectedTerms],
  );

  /** listSeries falls back to category names, so only keep genuine series here. */
  const realSeries = useMemo(
    () => seriesOptions.filter((value) => !(CATEGORY_ORDER as readonly string[]).includes(value)),
    [seriesOptions],
  );

  useEffect(() => {
    const query = globalQuery.trim();
    if (!query) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      const domainFilter = domain === "all" ? {} : { domain };
      void window.api.promptOrchestrator
        .searchTerms({ query, series: series || undefined, ...domainFilter, limit: SEARCH_LIMIT })
        .then((reply) => {
          if (cancelled) return;
          const items = reply.ok === true ? reply.data : [];
          const grouped = new Map<string, PromptVocabularySearchItem[]>();
          for (const item of items) {
            const bucket = grouped.get(item.category) ?? [];
            bucket.push(item);
            grouped.set(item.category, bucket);
          }
          setPools(
            CATEGORY_ORDER.filter((category) => grouped.has(category))
              .map((category) => ({ category, terms: grouped.get(category) ?? [] })),
          );
          setError("");
        })
        .catch((cause) => {
          if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeCategory, domain, globalQuery, series]);

  useEffect(() => {
    if (globalQuery.trim()) return;
    let cancelled = false;
    const domainFilter = domain === "all" ? {} : { domain };
    setLoading(true);
    void window.api.promptOrchestrator.browseTerms({
      category: activeCategory,
      subcategory: activeSubcategory ?? undefined,
      series: series || undefined,
      ...domainFilter,
      limit: PAGE_SIZE,
      offset: 0,
    }).then((reply) => {
      if (cancelled) return;
      if (reply.ok === true) {
        setBrowseResult(reply.data);
        setError("");
      } else {
        setError(reply.error.message);
      }
    }).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [activeCategory, activeSubcategory, domain, globalQuery, series]);

  useEffect(() => {
    setActiveSubcategory(null);
  }, [activeCategory, domain, globalQuery, series]);

  /**
   * Packs and presets are projections of the same vocabulary. Load the three
   * pack categories once, then resolve the reference preset tags by exact
   * match; anything the local library lacks simply never renders.
   */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const catalogs = await Promise.all(
          PACK_CATEGORIES.map((category) =>
            window.api.promptOrchestrator
              .searchTerms({ category, limit: POOL_LIMIT })
              .then((reply) => (reply.ok === true ? reply.data : [])),
          ),
        );
        const unique = [...new Set(VOCABULARY_PRESETS.flatMap((preset) => preset.terms))];
        const resolved: PromptVocabularySearchItem[] = [];
        for (let index = 0; index < unique.length; index += 400) {
          const chunk = unique.slice(index, index + 400);
          const response = await window.api.promptOrchestrator.resolveTerms({ terms: chunk });
          if (cancelled) return;
          if (response.ok === true) resolved.push(...response.data);
        }
        if (cancelled) return;
        setPackCatalog(catalogs.flat());
        setPresetRows(resolved);
      } catch {
        // Collections are optional; the plain field picker stays usable.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const packs = useMemo(
    () =>
      VOCABULARY_PACKS.map((pack) => ({ pack, terms: resolvePackTerms(pack, packCatalog) })).filter(
        (entry) => entry.terms.length >= MIN_PACK_TERMS,
      ),
    [packCatalog],
  );

  const presets = useMemo(() => resolvePresets(VOCABULARY_PRESETS, presetRows), [presetRows]);

  useEffect(() => {
    if (mode === "packs" && packs.length === 0) setMode("fields");
    if (mode === "presets" && presets.length === 0) setMode("fields");
  }, [mode, packs.length, presets.length]);

  useEffect(() => {
    if (!globalQuery.trim() || pools.length === 0) return;
    if (!pools.some((pool) => pool.category === activeCategory)) {
      setActiveCategory(pools[0].category);
    }
  }, [activeCategory, globalQuery, pools]);

  const activePool = globalQuery.trim()
    ? pools.find((pool) => pool.category === activeCategory) ?? pools[0]
    : { category: activeCategory, terms: browseResult?.items ?? [] };
  const activeTotal = globalQuery.trim() ? activePool?.terms.length ?? 0 : browseResult?.total ?? 0;
  const allSubcategoriesTotal = globalQuery.trim()
    ? activeTotal
    : (browseResult?.subcategories.reduce((sum, row) => sum + row.count, 0) ?? activeTotal);

  const subcategories = useMemo(() => {
    if (!globalQuery.trim() && browseResult) {
      const counts = new Map(
        browseResult.subcategories.map((row) => [row.subcategory?.trim() ?? "", row.count]),
      );
      return {
        names: [...counts.keys()].filter(Boolean).sort((left, right) => left.localeCompare(right, "zh-CN")),
        uncategorized: counts.has(""),
        counts,
      };
    }
    const counts = new Map<string, number>();
    for (const term of activePool?.terms ?? []) {
      const value = term.subcategory?.trim() ?? "";
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return {
      names: [...counts.keys()].filter(Boolean).sort((left, right) => left.localeCompare(right, "zh-CN")),
      uncategorized: counts.has(""),
      counts,
    };
  }, [activePool, browseResult, globalQuery]);

  const filteredTerms = useMemo(() => {
    const needle = (filters[activeCategory] ?? "").trim().toLowerCase();
    return (activePool?.terms ?? []).filter((term) => {
      if (
        activeSubcategory !== null &&
        (term.subcategory?.trim() ?? "") !== activeSubcategory
      ) {
        return false;
      }
      if (!needle) return true;
      return [term.en, term.zh ?? "", term.template ?? ""].some((value) =>
        value.toLowerCase().includes(needle),
      );
    });
  }, [activeCategory, activePool, activeSubcategory, filters]);

  const selectedInCategory = (category: string): number =>
    selectedTerms.reduce((count, term) => count + (term.category === category ? 1 : 0), 0);

  const shown = shownByCategory[activeCategory] ?? PAGE_SIZE;
  const visible = filteredTerms.slice(0, shown);
  const chosen = selectedInCategory(activeCategory);

  const selectedGroups = useMemo(() => {
    const grouped = new Map<string, PickerSelectedTerm[]>();
    for (const term of selectedTerms) {
      const bucket = grouped.get(term.category) ?? [];
      bucket.push(term);
      grouped.set(term.category, bucket);
    }
    return [...grouped.entries()];
  }, [selectedTerms]);

  return (
    <section
      className="@container flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card/20"
      data-testid="term-picker"
    >
      <div className="shrink-0 space-y-2.5 border-b border-border px-3 py-2.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">{t("orchestrator.picker.title")}</h2>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
              {t("orchestrator.picker.hint")}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <span className="px-1 text-[11px] text-muted-foreground" data-testid="term-picker-count">
              {t("orchestrator.picker.selected", { count: selectedTerms.length })}
            </span>
            {selectedTerms.length > 0 && (
              <Button size="sm" variant="ghost" onClick={onClear} data-testid="term-picker-clear">
                {t("orchestrator.picker.clear")}
              </Button>
            )}
            {mode === "fields" && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setBrowserOpen(true)}
                data-testid="term-picker-browse"
              >
                <BookOpenIcon className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                {t("orchestrator.picker.browseAll")}
              </Button>
            )}
            {onToggleExpanded && (
              <Button
                size="sm"
                variant="ghost"
                aria-label={t(expanded ? "orchestrator.picker.collapse" : "orchestrator.picker.expand")}
                onClick={onToggleExpanded}
                data-testid="term-picker-expand"
              >
                {expanded ? (
                  <Minimize2Icon className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <Maximize2Icon className="h-3.5 w-3.5" aria-hidden="true" />
                )}
              </Button>
            )}
          </div>
        </div>
        {(packs.length > 0 || presets.length > 0) && (
          <div
            className="flex items-center gap-1"
            role="tablist"
            aria-label={t("orchestrator.picker.mode.label")}
            data-testid="term-picker-modes"
          >
            {(
              [
                ["fields", "orchestrator.picker.mode.fields"],
                ["packs", "orchestrator.picker.mode.packs"],
                ["presets", "orchestrator.picker.mode.presets"],
              ] as const
            ).map(([value, labelKey]) => {
              const available =
                value === "fields" ||
                (value === "packs" ? packs.length > 0 : presets.length > 0);
              if (!available) return null;
              const active = mode === value;
              const count = value === "packs" ? packs.length : value === "presets" ? presets.length : 0;
              return (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setMode(value)}
                  className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                  data-testid={`term-picker-mode-${value}`}
                >
                  {t(labelKey)}
                  {count > 0 && <span className="ml-1 tabular-nums opacity-70">{count}</span>}
                </button>
              );
            })}
          </div>
        )}
        {mode === "fields" && (
          <div
            className="flex flex-wrap items-center gap-1"
            role="group"
            aria-label={t("orchestrator.picker.domain.label")}
            data-testid="term-picker-domains"
          >
            {(["all", "shared", "real", "anime", "3d"] as const).map((value) => {
              const active = domain === value;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setDomain(value)}
                  className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                    active
                      ? "border-primary/50 bg-primary/15 text-primary"
                      : "border-border text-muted-foreground hover:bg-muted"
                  }`}
                  data-testid={`term-picker-domain-${value}`}
                >
                  {t(`orchestrator.picker.domain.${value}`)}
                </button>
              );
            })}
          </div>
        )}
        {mode === "fields" && (
          <Input
            aria-label={t("orchestrator.picker.search")}
            placeholder={t("orchestrator.picker.searchPlaceholder")}
            value={globalQuery}
            onChange={(event) => setGlobalQuery(event.target.value)}
            variant="outlined"
          />
        )}
        {mode === "fields" && realSeries.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto pb-0.5" data-testid="term-picker-series">
            {["", ...realSeries].map((value) => {
              const active = series === value;
              return (
                <button
                  key={value || "all"}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onSeriesChange(value)}
                  className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] transition-colors ${
                    active
                      ? "border-primary/50 bg-primary/15 text-primary"
                      : "border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {value || t("orchestrator.allSeries")}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {mode === "fields" && (
      <div
        className={`grid min-h-0 flex-1 grid-rows-[auto_auto_minmax(0,1fr)] ${WIDE_BODY}`}
        data-testid="term-picker-fields"
      >
        <nav
          aria-label={t("orchestrator.picker.fields")}
          className={`flex min-h-0 gap-1 overflow-x-auto border-b border-border/70 p-2 ${WIDE_NAV}`}
          data-testid="term-picker-categories"
        >
          {CATEGORY_ORDER.map((category) => {
            const active = activeCategory === category;
            const count = selectedInCategory(category);
            return (
              <button
                key={category}
                type="button"
                aria-pressed={active}
                onClick={() => setActiveCategory(category)}
                className={`flex shrink-0 items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors ${WIDE_CATEGORY_BUTTON} ${
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
                data-testid={`term-category-${category}`}
              >
                <span className="whitespace-nowrap">
{String(t(`orchestrator.categories.${category}`, category))}
                </span>
                {count > 0 && (
                  <span className="rounded bg-primary/10 px-1.5 text-[10px] tabular-nums text-primary">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div
          className={`flex min-h-0 gap-1 overflow-x-auto border-b border-border/70 p-2 ${WIDE_NAV}`}
          data-testid="term-picker-subcategories"
        >
          <button
            type="button"
            aria-pressed={activeSubcategory === null}
            onClick={() => setActiveSubcategory(null)}
            className={`flex shrink-0 items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-xs ${WIDE_SUBCATEGORY_BUTTON} ${
              activeSubcategory === null
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/60"
            }`}
          >
            <span>{t("orchestrator.picker.allSubcategories")}</span>
            <span className="text-[10px] tabular-nums opacity-70">{allSubcategoriesTotal}</span>
          </button>
          {subcategories.names.map((subcategory) => {
            const active = activeSubcategory === subcategory;
            const count = subcategories.counts.get(subcategory) ?? 0;
            return (
              <button
                key={subcategory}
                type="button"
                aria-pressed={active}
                onClick={() => setActiveSubcategory(subcategory)}
                className={`flex shrink-0 items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-xs ${WIDE_SUBCATEGORY_BUTTON} ${
                  active
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/60"
                }`}
                data-testid={`term-subcategory-${subcategory}`}
              >
                <span className="whitespace-nowrap">{subcategory}</span>
                <span className="text-[10px] tabular-nums opacity-70">{count}</span>
              </button>
            );
          })}
          {subcategories.uncategorized && (
            <button
              type="button"
              aria-pressed={activeSubcategory === ""}
              onClick={() => setActiveSubcategory("")}
              className={`flex shrink-0 items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs ${WIDE_SUBCATEGORY_BUTTON} ${
                activeSubcategory === ""
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted/60"
              }`}
            >
              <span>{t("orchestrator.picker.uncategorized")}</span>
              <span className="text-[10px] tabular-nums opacity-70">{subcategories.counts.get("") ?? 0}</span>
            </button>
          )}
        </div>

        <section className="flex min-h-0 min-w-0 flex-col" aria-label={t("orchestrator.picker.terms")}>
          <div className="shrink-0 space-y-2 border-b border-border/70 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="truncate text-xs font-medium">
                {t(`orchestrator.categories.${activeCategory}`, activeCategory)}
                {activeSubcategory !== null && (
                  <span className="text-muted-foreground"> / {activeSubcategory || t("orchestrator.picker.uncategorized")}</span>
                )}
              </h3>
              <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                {chosen}/{activeTotal}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <button
                type="button"
                className="rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-muted"
                onClick={() => {
                  const fresh = visible.find((term) => !selectedIds.has(term.id));
                  if (fresh) onAdd(fresh);
                }}
              >
                {t("orchestrator.picker.random")}
              </button>
              <button
                type="button"
                className="rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-muted"
                onClick={() => {
                  for (const term of visible) {
                    if (!selectedIds.has(term.id)) onAdd(term);
                  }
                }}
              >
                {t("orchestrator.picker.all")}
              </button>
              <button
                type="button"
                className="rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-muted"
                onClick={() => {
                  for (const term of selectedTerms) {
                    if (term.category === activeCategory) onRemove(term.id);
                  }
                }}
              >
                {t("orchestrator.picker.none")}
              </button>
              <input
                value={filters[activeCategory] ?? ""}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, [activeCategory]: event.target.value }))
                }
                placeholder={t("orchestrator.picker.poolSearch")}
                aria-label={`${t("orchestrator.picker.poolSearch")} ${activeCategory}`}
                className="ml-auto h-7 min-w-[160px] flex-1 rounded border border-border bg-background px-2 text-[11px] outline-none focus:ring-1 focus:ring-primary/30 sm:max-w-[240px]"
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {loading && <p className="p-2 text-[11px] text-muted-foreground">{t("common.loading")}</p>}
            {error && (
              <p role="alert" className="p-2 text-[11px] text-destructive">
                {error}
              </p>
            )}
            {!loading && !error && !activePool && (
              <p className="p-2 text-[11px] text-muted-foreground">{t("orchestrator.picker.empty")}</p>
            )}
            {!loading && !error && activePool && (
              <>
                <div
                  className="grid gap-1.5"
                  style={{
                    gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 260px), 1fr))",
                  }}
                >
                  {visible.map((term) => {
                    const selected = selectedIds.has(term.id);
                    return (
                      <PromptTermChip
                        key={term.id}
                        term={term}
                        selected={selected}
                        hint={globalQuery.trim() ? term.subcategory : null}
                        testId={`term-chip-${term.id}`}
                        onToggle={() => (selected ? onRemove(term.id) : onAdd(term))}
                      />
                    );
                  })}
                </div>
                {visible.length === 0 && (
                  <p className="p-2 text-[11px] text-muted-foreground">
                    {t("orchestrator.picker.poolEmpty")}
                  </p>
                )}
                {filteredTerms.length > visible.length && (
                  <button
                    type="button"
                    onClick={() =>
                      setShownByCategory((current) => ({
                        ...current,
                        [activeCategory]: (current[activeCategory] ?? PAGE_SIZE) + PAGE_SIZE,
                      }))
                    }
                    className="mt-2 w-full rounded-md border border-border/60 px-3 py-2 text-center text-[11px] text-muted-foreground hover:bg-muted"
                    data-testid={`term-pool-more-${activeCategory}`}
                  >
                    {t("orchestrator.picker.more", {
                      count: Math.min(PAGE_SIZE, filteredTerms.length - visible.length),
                      total: filteredTerms.length,
                    })}
                  </button>
                )}
                {!globalQuery.trim() && activeTotal > filteredTerms.length && (
                  <button
                    type="button"
                    onClick={() => setBrowserOpen(true)}
                    className="mt-2 w-full rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-center text-[11px] text-primary hover:bg-primary/10"
                    data-testid="term-picker-browse-rest"
                  >
                    {t("orchestrator.picker.browseAllCount", { count: activeTotal })}
                  </button>
                )}
              </>
            )}
          </div>
        </section>
      </div>
      )}
      {mode === "packs" && (
        <PromptVocabularyPackBrowser
          packs={packs}
          selectedIds={selectedIds}
          onAdd={onAdd}
          onRemove={onRemove}
        />
      )}
      {mode === "presets" && (
        <PromptVocabularyPresetBrowser
          presets={presets}
          selectedIds={selectedIds}
          onAdd={onAdd}
        />
      )}

      {selectedTerms.length > 0 && (
        <div
          className="max-h-32 shrink-0 space-y-1.5 overflow-y-auto border-t border-border bg-background/60 p-2"
          data-testid="term-picker-selected"
        >
          {selectedGroups.map(([category, terms]) => (
            <div key={category} className="flex flex-wrap items-center gap-1.5">
              <span className="w-12 shrink-0 text-[10px] text-muted-foreground">
                {t(`orchestrator.categories.${category}`, category)}
              </span>
              {terms.map((term) => {
                const state = term.state ?? "locked";
                return (
                  <span
                    key={term.id}
                    className={`inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-1 text-[11px] ${STATE_CHIP[state]}`}
                  >
                    <select
                      value={state}
                      aria-label={`${t("orchestrator.picker.stateLabel")} ${term.en}`}
                      onChange={(event) =>
                        onStateChange?.(term.id, event.target.value as PickerTermState)}
                      disabled={!onStateChange}
                      className="shrink-0 cursor-pointer bg-transparent text-[10px] uppercase tracking-wide outline-none disabled:cursor-default"
                      data-testid={`term-state-${term.id}`}
                    >
                      {TERM_STATES.map((option) => (
                        <option key={option} value={option}>
                          {t(`orchestrator.picker.states.${option}`)}
                        </option>
                      ))}
                    </select>
                    <span className="truncate">{formatTermLabel(term)}</span>
                    <button
                      type="button"
                      aria-label={`${t("orchestrator.picker.remove")} ${term.en}`}
                      onClick={() => onRemove(term.id)}
                      className="shrink-0 opacity-70 hover:opacity-100"
                      data-testid={`term-locked-${term.id}`}
                    >
                      <XIcon className="h-3 w-3" />
                    </button>
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      )}
      <PromptVocabularyBrowserModal
        isOpen={browserOpen}
        onClose={() => setBrowserOpen(false)}
        initialCategory={activeCategory}
        initialSubcategory={activeSubcategory}
        initialDomain={domain}
        series={series}
        selectedTerms={selectedTerms}
        onAdd={onAdd}
        onRemove={onRemove}
      />
    </section>
  );
}
