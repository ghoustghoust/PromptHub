import { useEffect, useState } from "react";
import { CheckIcon, PlusIcon, XIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PromptVocabularySearchItem } from "@prompthub/shared/types";
import { Input } from "../ui/Input";
import { Select } from "../ui/Select";
import { PREFAB_CATEGORIES } from "./prompt-orchestrator-catalog";

interface PromptVocabularyPrefabPanelProps {
  series: string;
  selectedTerms: PromptVocabularySearchItem[];
  onAdd: (term: PromptVocabularySearchItem) => void;
  onRemove: (id: string) => void;
}

export function PromptVocabularyPrefabPanel({
  series,
  selectedTerms,
  onAdd,
  onRemove,
}: PromptVocabularyPrefabPanelProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [results, setResults] = useState<PromptVocabularySearchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      void window.api.promptOrchestrator.searchTerms({
        query: query.trim() || undefined,
        category: category || undefined,
        series: series || undefined,
        limit: 50,
      }).then((reply) => {
        if (!active) return;
        if (reply.ok === true) {
          setResults(reply.data);
          setError("");
        } else {
          setError(reply.error.message);
        }
      }).catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      }).finally(() => {
        if (active) setLoading(false);
      });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [category, query, series]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3" data-testid="prefab-panel">
      <div>
        <h2 className="text-sm font-semibold">{t("orchestrator.prefabTitle")}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{t("orchestrator.prefabDescription")}</p>
      </div>
      <Input
        aria-label={t("orchestrator.prefabSearch")}
        placeholder={t("orchestrator.prefabSearchPlaceholder")}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        variant="outlined"
      />
      <Select
        ariaLabel={t("orchestrator.prefabCategory")}
        value={category}
        onChange={setCategory}
        options={[
          { value: "", label: t("orchestrator.allCategories") },
          ...PREFAB_CATEGORIES.map((value) => ({
            value,
            label: t(`orchestrator.categories.${value}`, value),
          })),
        ]}
        presentation="form"
      />
      <section className="space-y-2">
        <h3 className="text-xs font-medium text-muted-foreground">
          {t("orchestrator.prefabSelected", { count: selectedTerms.length })}
        </h3>
        <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto">
          {selectedTerms.map((term) => (
            <span key={term.id} className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-xs text-primary">
              <span>{term.template ?? term.en}</span>
              <button type="button" aria-label={`${t("orchestrator.removePrefab")} ${term.en}`} onClick={() => onRemove(term.id)}>
                <XIcon className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      </section>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto border-t border-border pt-3">
        {loading && <p className="text-xs text-muted-foreground">{t("common.loading")}</p>}
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        {!loading && results.length === 0 && (
          <p className="text-xs text-muted-foreground">{t("orchestrator.prefabEmpty")}</p>
        )}
        {results.map((term) => {
          const selected = selectedTerms.some((item) => item.id === term.id);
          return (
            <div key={term.id} className="flex items-start gap-2 rounded-lg border border-border/70 p-3">
              <div className="min-w-0 flex-1">
                <div className="text-xs text-muted-foreground">{term.category}{term.series ? ` · ${term.series}` : ""}</div>
                <div className="mt-1 text-sm">{term.template ?? term.en}</div>
                {term.zh && <div className="mt-0.5 text-xs text-muted-foreground">{term.zh}</div>}
              </div>
              <button
                type="button"
                aria-label={`${t("orchestrator.addPrefab")} ${term.en}`}
                disabled={selected}
                onClick={() => onAdd(term)}
                className="rounded-md p-1.5 text-primary hover:bg-primary/10 disabled:opacity-30"
              >
                {selected ? <CheckIcon className="h-4 w-4" /> : <PlusIcon className="h-4 w-4" />}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
