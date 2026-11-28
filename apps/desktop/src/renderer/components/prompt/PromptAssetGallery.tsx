import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  PromptAssetKindCount,
  PromptAssetQueryResult,
  PromptSourceAsset,
} from "@prompthub/shared/types";
import { assetMetaEntries, assetPageRange, assetSubtitle } from "./asset-gallery-view";

const PAGE_SIZE = 24;
const KINDS = ["all", "costume", "hair", "portrait", "pose"] as const;
type AssetKindFilter = (typeof KINDS)[number];
const THUMBNAIL_CACHE_LIMIT = 500;

/**
 * Read-only picture libraries from the 014 package. Browsing only: nothing here
 * selects an asset or sends a picture to the model, and the source files are
 * never copied.
 */
export function PromptAssetGallery({ disabled }: { disabled?: boolean }) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<AssetKindFilter>("all");
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<PromptAssetQueryResult | null>(null);
  const [counts, setCounts] = useState<PromptAssetKindCount[]>([]);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<PromptSourceAsset | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [defaultRoot, setDefaultRoot] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const thumbnailsRef = useRef<Record<string, string>>({});

  const loadCounts = useCallback(async () => {
    const reply = await window.api.promptAsset.countByKind();
    if (reply.ok === true) setCounts(reply.data);
    return reply.ok === true ? reply.data : [];
  }, []);

  const runScan = useCallback(
    async (root?: string) => {
      setScanning(true);
      setScanNote("");
      try {
        const reply = await window.api.promptAsset.importLibrary(root);
        if (reply.ok !== true) {
          setScanNote(reply.error.message);
          return;
        }
        const total = Object.values(reply.data.counts).reduce((sum, value) => sum + value, 0);
        setScanNote(
          t("orchestrator.assetLibrary.scanDone", {
            count: total,
            inserted: reply.data.inserted,
          }),
        );
        setDefaultRoot(reply.data.root);
        await loadCounts();
        setReloadKey((value) => value + 1);
      } catch (cause) {
        setScanNote(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setScanning(false);
      }
    },
    [loadCounts, t],
  );

  // The default library is a folder, not a per-user import dialog: index it the
  // first time the gallery is opened, and rescan on demand afterwards.
  const bootstrapped = useRef(false);
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    let active = true;
    void (async () => {
      const rootReply = await window.api.promptAsset.defaultRoot();
      if (!active) return;
      const root = rootReply.ok === true ? rootReply.data : null;
      setDefaultRoot(root);
      const kinds = await loadCounts();
      if (!active) return;
      const total = kinds.reduce((sum, entry) => sum + entry.count, 0);
      if (total === 0 && root) await runScan();
    })();
    return () => {
      active = false;
    };
  }, [loadCounts, runScan]);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(queryInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [queryInput]);

  useEffect(() => {
    setPage(0);
  }, [kind, query]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void window.api.promptAsset
      .list({
        ...(kind === "all" ? {} : { kind }),
        ...(query ? { query } : {}),
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      })
      .then((reply) => {
        if (!active) return;
        if (reply.ok !== true) {
          setError(reply.error.message);
          return;
        }
        setResult(reply.data);
        setSelected(null);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [kind, query, page, reloadKey]);

  const items = result?.items ?? [];

  // One decode at a time, so a page of pictures never blocks the main process.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const asset of items) {
        if (cancelled) return;
        if (thumbnailsRef.current[asset.id]) continue;
        const reply = await window.api.promptAsset.thumbnail(asset.id);
        if (cancelled) return;
        if (reply.ok !== true || !reply.data) continue;
        const next = { ...thumbnailsRef.current, [asset.id]: reply.data };
        const keys = Object.keys(next);
        if (keys.length > THUMBNAIL_CACHE_LIMIT) delete next[keys[0]];
        thumbnailsRef.current = next;
        setThumbnails(next);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [items]);

  const total = result?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const countOf = useMemo(() => {
    const map = new Map(counts.map((entry) => [entry.kind, entry.count]));
    return (value: AssetKindFilter): number =>
      value === "all" ? counts.reduce((sum, entry) => sum + entry.count, 0) : map.get(value) ?? 0;
  }, [counts]);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="orchestrator-asset-gallery">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border/60 px-3 py-2">
        {KINDS.map((value) => (
          <button
            key={value}
            type="button"
            className={`rounded-md border px-2 py-1 text-[11px] ${
              kind === value
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border/60 bg-muted/20 text-muted-foreground"
            }`}
            onClick={() => setKind(value)}
            disabled={disabled}
            data-testid={`orchestrator-asset-kind-${value}`}
            data-active={kind === value}
          >
            {t(`orchestrator.assetLibrary.kinds.${value}`)}
            <span className="ml-1 text-muted-foreground">{countOf(value)}</span>
          </button>
        ))}
        <input
          type="search"
          value={queryInput}
          onChange={(event) => setQueryInput(event.target.value)}
          placeholder={t("orchestrator.assetLibrary.searchPlaceholder")}
          className="ml-auto h-7 w-48 rounded-md border border-border bg-background px-2 text-xs"
          disabled={disabled}
          data-testid="orchestrator-asset-search"
        />
        <button
          type="button"
          className="h-7 shrink-0 rounded-md border border-border px-2 text-[11px] disabled:opacity-40"
          onClick={() => void runScan()}
          disabled={disabled || scanning}
          data-testid="orchestrator-asset-rescan"
        >
          {scanning
            ? t("orchestrator.assetLibrary.scanning")
            : t("orchestrator.assetLibrary.scan")}
        </button>
      </div>

      <p className="shrink-0 px-3 pt-2 text-[11px] text-muted-foreground">
        {t("orchestrator.assetLibrary.hint")}
      </p>
      {(scanNote || defaultRoot) && (
        <p
          className="shrink-0 truncate px-3 text-[11px] text-muted-foreground"
          title={defaultRoot ?? undefined}
          data-testid="orchestrator-asset-root"
        >
          {scanNote || `${t("orchestrator.assetLibrary.rootLabel")}: ${defaultRoot}`}
        </p>
      )}

      {selected && (
        <div
          className="mx-3 mt-2 shrink-0 rounded-lg border border-border/70 bg-muted/20 p-2"
          data-testid="orchestrator-asset-detail"
        >
          <div className="flex items-start gap-2">
            {thumbnails[selected.id] ? (
              <img
                src={thumbnails[selected.id]}
                alt={selected.title ?? selected.id}
                className="h-24 w-24 shrink-0 rounded border border-border/60 object-cover"
              />
            ) : (
              <span className="h-24 w-24 shrink-0 rounded border border-dashed border-border/60" />
            )}
            <div className="min-w-0 flex-1 space-y-1">
              <p className="truncate text-xs font-medium" title={selected.title ?? selected.id}>
                {selected.title ?? selected.id}
              </p>
              <p className="break-all text-[11px] text-muted-foreground">{selected.id}</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-2 text-[11px]">
                {assetMetaEntries(selected)
                  .slice(0, 8)
                  .map((entry) => (
                    <div key={entry.key} className="contents">
                      <dt className="text-muted-foreground">{entry.key}</dt>
                      <dd className="min-w-0 break-words">{entry.value}</dd>
                    </div>
                  ))}
              </dl>
            </div>
            <button
              type="button"
              className="shrink-0 text-[11px] underline-offset-2 hover:underline"
              onClick={() => setSelected(null)}
              data-testid="orchestrator-asset-detail-close"
            >
              {t("orchestrator.assetLibrary.close")}
            </button>
          </div>
          <p className="mt-1 break-all text-[11px] text-muted-foreground">{selected.path}</p>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {error && (
          <p className="text-[11px] text-destructive" data-testid="orchestrator-asset-error">
            {error}
          </p>
        )}
        {!error && items.length === 0 && !loading && (
          <div className="space-y-1 py-8 text-center" data-testid="orchestrator-asset-empty">
            <p className="text-xs text-muted-foreground">{t("orchestrator.assetLibrary.empty")}</p>
            <p className="text-[11px] text-muted-foreground">
              {t("orchestrator.assetLibrary.emptyHint")}
            </p>
            {!defaultRoot && (
              <button
                type="button"
                className="mt-2 rounded-md border border-border px-2 py-1 text-[11px] disabled:opacity-40"
                disabled={disabled || scanning}
                onClick={() => {
                  void (async () => {
                    const folder = await window.electron?.selectFolder?.();
                    if (folder) await runScan(folder);
                  })();
                }}
                data-testid="orchestrator-asset-choose-folder"
              >
                {t("orchestrator.assetLibrary.chooseFolder")}
              </button>
            )}
          </div>
        )}
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-2">
          {items.map((asset) => (
            <li key={asset.id} className="min-w-0">
              <button
                type="button"
                className={`w-full space-y-1 rounded-lg border p-1.5 text-left transition-colors hover:border-primary/50 ${
                  selected?.id === asset.id ? "border-primary/60 bg-primary/5" : "border-border/60"
                }`}
                onClick={() => setSelected(asset)}
                disabled={disabled}
                data-testid={`orchestrator-asset-card-${asset.id}`}
              >
                {thumbnails[asset.id] ? (
                  <img
                    src={thumbnails[asset.id]}
                    alt={asset.title ?? asset.id}
                    className="h-32 w-full rounded object-cover"
                    loading="lazy"
                  />
                ) : (
                  <span className="block h-32 w-full rounded bg-muted/40" />
                )}
                <span className="block truncate text-[11px] font-medium" title={asset.title ?? asset.id}>
                  {asset.title ?? asset.id}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {assetSubtitle(asset)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border/60 px-3 py-1.5 text-[11px] text-muted-foreground">
        <span data-testid="orchestrator-asset-range">
          {assetPageRange(page * PAGE_SIZE, items.length, total)}
        </span>
        <span className="flex items-center gap-1">
          <button
            type="button"
            className="rounded border border-border px-2 py-0.5 disabled:opacity-40"
            onClick={() => setPage((value) => Math.max(0, value - 1))}
            disabled={disabled || page === 0}
            data-testid="orchestrator-asset-prev"
          >
            {t("orchestrator.assetLibrary.prev")}
          </button>
          <button
            type="button"
            className="rounded border border-border px-2 py-0.5 disabled:opacity-40"
            onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}
            disabled={disabled || page + 1 >= pageCount}
            data-testid="orchestrator-asset-next"
          >
            {t("orchestrator.assetLibrary.next")}
          </button>
        </span>
      </div>
    </div>
  );
}