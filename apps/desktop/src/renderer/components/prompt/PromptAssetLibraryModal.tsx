import { useTranslation } from "react-i18next";
import type { PromptAssetKindCount, PromptSourceAsset } from "@prompthub/shared/types";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Modal } from "../ui/Modal";
import { LocalImage } from "../ui/LocalImage";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  items: PromptSourceAsset[];
  total: number;
  kindCounts: PromptAssetKindCount[];
  kind: string;
  query: string;
  thumbnails: Record<string, string>;
  selectedIds: string[];
  hasMore: boolean;
  onKindChange: (kind: string) => void;
  onQueryChange: (query: string) => void;
  onToggle: (id: string) => void;
  onClearSelection: () => void;
  onLoadMore: () => void;
  onImport: () => void;
}

/**
 * Browses the imported picture library: filter by library, search the labels
 * and mark the materials a later step will bind to a role.
 */
export function PromptAssetLibraryModal({
  isOpen,
  onClose,
  items,
  total,
  kindCounts,
  kind,
  query,
  thumbnails,
  selectedIds,
  hasMore,
  onKindChange,
  onQueryChange,
  onToggle,
  onClearSelection,
  onLoadMore,
  onImport,
}: Props) {
  const { t } = useTranslation();
  const kinds = [
    { kind: "", count: kindCounts.reduce((sum, entry) => sum + entry.count, 0) },
    ...kindCounts,
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("orchestrator.assetLibrary.title")}
      subtitle={t("orchestrator.assetLibrary.hint")}
      size="full"
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground" data-testid="asset-library-selected">
            {t("orchestrator.assetLibrary.selected", { count: selectedIds.length })}
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={onClearSelection}
              disabled={selectedIds.length === 0}
              data-testid="asset-library-clear"
            >
              {t("orchestrator.assetLibrary.clearSelection")}
            </Button>
            <Button size="sm" variant="secondary" onClick={onImport} data-testid="asset-library-import">
              {t("orchestrator.assetLibrary.import")}
            </Button>
            <Button size="sm" variant="primary" onClick={onClose} data-testid="asset-library-close">
              {t("orchestrator.assetLibrary.close")}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {kinds.map((entry) => {
            const active = kind === entry.kind;
            return (
              <button
                key={entry.kind || "all"}
                type="button"
                aria-pressed={active}
                onClick={() => onKindChange(entry.kind)}
                className={`rounded border px-2 py-0.5 text-[11px] transition-colors ${
                  active
                    ? "border-primary/50 bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
                data-testid={`asset-library-kind-${entry.kind || "all"}`}
              >
                {entry.kind
                  ? t(`orchestrator.assetLibrary.kinds.${entry.kind}`, entry.kind)
                  : t("orchestrator.assetLibrary.allKinds")}
                {" · "}
                {entry.count}
              </button>
            );
          })}
        </div>

        <Input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={t("orchestrator.assetLibrary.search")}
          aria-label={t("orchestrator.assetLibrary.search")}
          variant="outlined"
          data-testid="asset-library-search"
        />

        <p className="text-xs text-muted-foreground" data-testid="asset-library-total">
          {t("orchestrator.assetLibrary.total", { count: total })}
        </p>

        {items.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground" data-testid="asset-library-empty">
            {total === 0
              ? t("orchestrator.assetLibrary.empty")
              : t("orchestrator.assetLibrary.emptyFilter")}
          </p>
        ) : (
          <div
            className="grid grid-cols-3 gap-2 sm:grid-cols-4 xl:grid-cols-6"
            data-testid="asset-library-grid"
          >
            {items.map((item) => {
              const selected = selectedIds.includes(item.id);
              const thumbnail = thumbnails[item.id] ?? "";
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onToggle(item.id)}
                  className={`overflow-hidden rounded-md border text-left transition-colors ${
                    selected
                      ? "border-primary ring-2 ring-primary/40"
                      : "border-border hover:border-primary/50"
                  }`}
                  data-testid={`asset-library-item-${item.id}`}
                >
                  <LocalImage
                    src={thumbnail}
                    alt={item.title ?? item.id}
                    className="h-20 w-full object-cover"
                    fallbackClassName="h-20 w-full"
                  />
                  <span
                    className="block truncate px-2 pt-1 text-[11px] font-medium"
                    title={item.title ?? item.id}
                    data-testid="asset-library-item-title"
                  >
                    {item.title ?? item.id}
                  </span>
                  <span
                    className="block px-2 pb-1 text-[10px] text-muted-foreground"
                    data-testid="asset-library-item-kind"
                  >
                    {item.kind}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {hasMore && (
          <div className="flex justify-center">
            <Button size="sm" variant="secondary" onClick={onLoadMore} data-testid="asset-library-more">
              {t("orchestrator.assetLibrary.loadMore")}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
