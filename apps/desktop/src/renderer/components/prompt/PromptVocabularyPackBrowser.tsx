import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PromptVocabularySearchItem } from "@prompthub/shared/types";
import { PromptTermChip } from "./PromptTermChip";
import { localized, type VocabularyCollectionGroup, type VocabularyPack } from "./prompt-vocabulary-collections";

export interface ResolvedPack {
  pack: VocabularyPack;
  terms: PromptVocabularySearchItem[];
}

interface PromptVocabularyPackBrowserProps {
  packs: ResolvedPack[];
  selectedIds: ReadonlySet<string>;
  onAdd: (term: PromptVocabularySearchItem) => void;
  onRemove: (id: string) => void;
}

const GROUPS: VocabularyCollectionGroup[] = ["style", "medium"];

export function PromptVocabularyPackBrowser({
  packs,
  selectedIds,
  onAdd,
  onRemove,
}: PromptVocabularyPackBrowserProps) {
  const { t, i18n } = useTranslation();
  const [activeId, setActiveId] = useState<string>("");

  useEffect(() => {
    if (packs.length === 0) {
      if (activeId) setActiveId("");
      return;
    }
    if (!packs.some((entry) => entry.pack.id === activeId)) {
      setActiveId(packs[0].pack.id);
    }
  }, [activeId, packs]);

  const active = packs.find((entry) => entry.pack.id === activeId) ?? packs[0];

  const grouped = useMemo(() => {
    const map = new Map<string, PromptVocabularySearchItem[]>();
    for (const term of active?.terms ?? []) {
      const bucket = map.get(term.category) ?? [];
      bucket.push(term);
      map.set(term.category, bucket);
    }
    return [...map.entries()];
  }, [active]);

  const chosen = active
    ? active.terms.reduce((count, term) => count + (selectedIds.has(term.id) ? 1 : 0), 0)
    : 0;

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] [@container(min-width:620px)]:grid-cols-[190px_minmax(0,1fr)] [@container(min-width:620px)]:grid-rows-1">
      <nav
        aria-label={t("orchestrator.picker.packs.title")}
        className="flex max-h-40 shrink-0 flex-col gap-1 overflow-y-auto border-b border-border/70 p-2 [@container(min-width:620px)]:max-h-none [@container(min-width:620px)]:border-b-0 [@container(min-width:620px)]:border-r"
        data-testid="term-packs-list"
      >
        {GROUPS.map((group) => {
          const entries = packs.filter((entry) => entry.pack.group === group);
          if (entries.length === 0) return null;
          return (
            <div key={group} className="space-y-0.5">
              <p className="px-2 pt-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {t(`orchestrator.picker.packs.group.${group}`)}
              </p>
              {entries.map(({ pack, terms }) => {
                const isActive = active?.pack.id === pack.id;
                const picked = terms.reduce(
                  (count, term) => count + (selectedIds.has(term.id) ? 1 : 0),
                  0,
                );
                return (
                  <button
                    key={pack.id}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => setActiveId(pack.id)}
                    className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors ${
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                    data-testid={`term-pack-${pack.id}`}
                  >
                    <span className="truncate">{localized(pack.name, i18n.language)}</span>
                    <span className="shrink-0 text-[10px] tabular-nums opacity-70">
                      {picked > 0 ? `${picked}/${terms.length}` : terms.length}
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </nav>

      <section className="flex min-h-0 min-w-0 flex-col" aria-label={t("orchestrator.picker.packs.title")}>
        {active ? (
          <>
            <div className="shrink-0 space-y-1 border-b border-border/70 px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="truncate text-xs font-medium">{localized(active.pack.name, i18n.language)}</h3>
                  <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                    {localized(active.pack.description, i18n.language)}
                  </p>
                </div>
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                  {chosen}/{active.terms.length}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  className="rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-muted"
                  onClick={() => {
                    for (const term of active.terms) {
                      if (!selectedIds.has(term.id)) onAdd(term);
                    }
                  }}
                  data-testid="term-pack-add-all"
                >
                  {t("orchestrator.picker.packs.lockAll")}
                </button>
                <button
                  type="button"
                  className="rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-muted"
                  onClick={() => {
                    for (const term of active.terms) {
                      if (selectedIds.has(term.id)) onRemove(term.id);
                    }
                  }}
                  data-testid="term-pack-clear"
                >
                  {t("orchestrator.picker.packs.clear")}
                </button>
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
                        const selected = selectedIds.has(term.id);
                        return (
                          <PromptTermChip
                            key={term.id}
                            term={term}
                            selected={selected}
                            hint={term.subcategory}
                            testId={`term-chip-${term.id}`}
                            onToggle={() => (selected ? onRemove(term.id) : onAdd(term))}
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
          <p className="p-3 text-[11px] text-muted-foreground">{t("orchestrator.picker.packs.empty")}</p>
        )}
      </section>
    </div>
  );
}