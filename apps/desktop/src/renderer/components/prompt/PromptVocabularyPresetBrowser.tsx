import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PromptVocabularySearchItem } from "@prompthub/shared/types";
import { Button } from "../ui/Button";
import { PromptTermChip } from "./PromptTermChip";
import { localized, type ResolvedPreset } from "./prompt-vocabulary-collections";

interface PromptVocabularyPresetBrowserProps {
  presets: ResolvedPreset[];
  selectedIds: ReadonlySet<string>;
  onAdd: (term: PromptVocabularySearchItem) => void;
}

export function PromptVocabularyPresetBrowser({
  presets,
  selectedIds,
  onAdd,
}: PromptVocabularyPresetBrowserProps) {
  const { t, i18n } = useTranslation();
  const [activeId, setActiveId] = useState<string>("");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(0);

  useEffect(() => {
    if (presets.length === 0) {
      if (activeId) setActiveId("");
      return;
    }
    if (!presets.some((entry) => entry.preset.id === activeId)) {
      setActiveId(presets[0].preset.id);
    }
  }, [activeId, presets]);

  const active = presets.find((entry) => entry.preset.id === activeId) ?? presets[0];

  useEffect(() => {
    setChosen(new Set((active?.terms ?? []).map((term) => term.id)));
    setLoaded(0);
  }, [active]);

  const grouped = useMemo(() => {
    const map = new Map<string, PromptVocabularySearchItem[]>();
    for (const term of active?.terms ?? []) {
      const bucket = map.get(term.category) ?? [];
      bucket.push(term);
      map.set(term.category, bucket);
    }
    return [...map.entries()];
  }, [active]);

  const pending = (active?.terms ?? []).filter(
    (term) => chosen.has(term.id) && !selectedIds.has(term.id),
  );

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] [@container(min-width:620px)]:grid-cols-[200px_minmax(0,1fr)] [@container(min-width:620px)]:grid-rows-1">
      <nav
        aria-label={t("orchestrator.picker.presets.title")}
        className="flex max-h-40 shrink-0 flex-col gap-0.5 overflow-y-auto border-b border-border/70 p-2 [@container(min-width:620px)]:max-h-none [@container(min-width:620px)]:border-b-0 [@container(min-width:620px)]:border-r"
        data-testid="term-presets-list"
      >
        {presets.map(({ preset, terms }) => {
          const locked = terms.reduce(
            (count, term) => count + (selectedIds.has(term.id) ? 1 : 0),
            0,
          );
          const isActive = active?.preset.id === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              aria-pressed={isActive}
              onClick={() => setActiveId(preset.id)}
              className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors ${
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
              data-testid={`term-preset-${preset.id}`}
            >
              <span className="truncate">{localized(preset.name, i18n.language)}</span>
              <span className="shrink-0 text-[10px] tabular-nums opacity-70">
                {locked > 0 ? `${locked}/${terms.length}` : terms.length}
              </span>
            </button>
          );
        })}
      </nav>

      <section className="flex min-h-0 min-w-0 flex-col" aria-label={t("orchestrator.picker.presets.title")}>
        {active ? (
          <>
            <div className="shrink-0 space-y-1.5 border-b border-border/70 px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="truncate text-xs font-medium">
                    {localized(active.preset.name, i18n.language)}
                  </h3>
                  <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                    {localized(active.preset.description, i18n.language)}
                  </p>
                </div>
                <span
                  className="shrink-0 text-[11px] tabular-nums text-muted-foreground"
                  data-testid="term-preset-hits"
                >
                  {t("orchestrator.picker.presets.hits", {
                    hit: active.hits,
                    total: active.total,
                  })}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <Button
                  size="sm"
                  disabled={pending.length === 0}
                  onClick={() => {
                    for (const term of pending) onAdd(term);
                    setLoaded(pending.length);
                  }}
                  data-testid="term-preset-load"
                >
                  {t("orchestrator.picker.presets.load", { count: pending.length })}
                </Button>
                <button
                  type="button"
                  className="rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-muted"
                  onClick={() => setChosen(new Set(active.terms.map((term) => term.id)))}
                >
                  {t("orchestrator.picker.presets.selectAll")}
                </button>
                <button
                  type="button"
                  className="rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-muted"
                  onClick={() => setChosen(new Set())}
                >
                  {t("orchestrator.picker.presets.selectNone")}
                </button>
                {loaded > 0 && (
                  <span className="ml-auto text-[11px] text-primary" data-testid="term-preset-loaded">
                    {t("orchestrator.picker.presets.loaded", { count: loaded })}
                  </span>
                )}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              <div className="space-y-3">
                {grouped.map(([category, terms]) => (
                  <div key={category}>
                    <h4 className="mb-1 flex items-center gap-2 px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      <span>{t(`orchestrator.categories.${category}`, category)}</span>
                      <span className="tabular-nums opacity-70">{terms.length}</span>
                    </h4>
                    <div
                      className="grid gap-1.5"
                      style={{
                        gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 240px), 1fr))",
                      }}
                    >
                      {terms.map((term) => {
                        const checked = chosen.has(term.id);
                        return (
                          <PromptTermChip
                            key={term.id}
                            term={term}
                            selected={checked}
                            hint={term.subcategory}
                            testId={`term-preset-chip-${term.id}`}
                            onToggle={() =>
                              setChosen((current) => {
                                const next = new Set(current);
                                if (next.has(term.id)) next.delete(term.id);
                                else next.add(term.id);
                                return next;
                              })
                            }
                          />
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <p className="p-3 text-[11px] text-muted-foreground">{t("orchestrator.picker.presets.empty")}</p>
        )}
      </section>
    </div>
  );
}