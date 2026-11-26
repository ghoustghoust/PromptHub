import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PromptReferenceItem } from "@prompthub/shared/types";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Select } from "../ui/Select";
import { LocalImage } from "../ui/LocalImage";

const MAX_REFERENCES = 3;

interface Props {
  items: PromptReferenceItem[];
  selectedIds: string[];
  disabled?: boolean;
  error?: string;
  referenceTokens?: number;
  /** Pictures handed out by the main process, keyed by the record id. */
  thumbnails?: Record<string, string>;
  /** Opens the import flow of the color card libraries. */
  onImport?: () => void;
  onToggle: (id: string) => void;
}

/** Director color cards: a reference library, separate from knowledge modules. */
export function PromptReferencePicker({
  items,
  selectedIds,
  disabled = false,
  error = "",
  referenceTokens = 0,
  thumbnails = {},
  onImport,
  onToggle,
}: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const categories = useMemo(
    () => [...new Set(items.map((item) => item.category))].sort(),
    [items],
  );
  const filtered = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return items.filter((item) => {
      if (category && item.category !== category) return false;
      if (terms.length === 0) return true;
      const haystack = `${item.nameZh} ${item.nameEn ?? ""} ${item.summary}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }, [items, category, query]);
  const full = selectedIds.length >= MAX_REFERENCES;

  return (
    <div className="space-y-2 rounded-lg border border-border/70 p-3" data-testid="orchestrator-reference-picker">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium">{t("orchestrator.reference.title")}</span>
        {onImport && (
          <Button
            size="sm"
            variant="secondary"
            onClick={onImport}
            disabled={disabled}
            data-testid="reference-import-open"
          >
            {t("orchestrator.library.import")}
          </Button>
        )}
        <span className="text-[11px] text-muted-foreground" data-testid="reference-selected-count">
          {t("orchestrator.reference.selected", {
            count: selectedIds.length,
            max: MAX_REFERENCES,
          })}
        </span>
        <span className="text-[11px] text-muted-foreground" data-testid="reference-tokens">
          {t("orchestrator.reference.tokens", { tokens: referenceTokens })}
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground">{t("orchestrator.reference.hint")}</p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("orchestrator.reference.search")}
            aria-label={t("orchestrator.reference.search")}
            variant="outlined"
            data-testid="reference-search"
          />
        </div>
        <div className="w-44">
          <Select
            value={category}
            options={[
              { value: "", label: t("orchestrator.reference.allCategories") },
              ...categories.map((name) => ({ value: name, label: name })),
            ]}
            onChange={setCategory}
            disabled={disabled}
            presentation="compact"
            ariaLabel={t("orchestrator.reference.category")}
          />
        </div>
      </div>
      {items.length === 0 ? (
        <p className="text-[11px] text-muted-foreground" data-testid="reference-empty">
          {t("orchestrator.reference.empty")}
        </p>
      ) : (
        <div className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3 xl:grid-cols-4">
          {filtered.map((item) => {
            const selected = selectedIds.includes(item.id);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onToggle(item.id)}
                disabled={disabled || (full && !selected)}
                aria-pressed={selected}
                className={`overflow-hidden rounded-md border text-left transition-colors ${
                  selected ? "border-primary ring-2 ring-primary/40" : "border-border hover:border-primary/50"
                } disabled:cursor-not-allowed disabled:opacity-50`}
                data-testid={`reference-card-${item.id}`}
              >
                <LocalImage
                  src={thumbnails[item.id] ?? ""}
                  alt={item.nameZh}
                  className="h-20 w-full object-cover"
                  fallbackClassName="h-20 w-full"
                />
                <span className="block truncate px-2 pt-1 text-[11px] font-medium" title={item.nameZh}>
                  {item.nameZh}
                </span>
                <span className="block px-2 pb-1 text-[10px] text-muted-foreground">
                  {item.category}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {selectedIds.length > 0 && (
        <div className="flex flex-wrap gap-1" data-testid="reference-selected-chips">
          {items
            .filter((item) => selectedIds.includes(item.id))
            .map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onToggle(item.id)}
                disabled={disabled}
                className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] text-primary"
                data-testid={`reference-chip-${item.id}`}
              >
                {item.nameZh} ×
              </button>
            ))}
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}