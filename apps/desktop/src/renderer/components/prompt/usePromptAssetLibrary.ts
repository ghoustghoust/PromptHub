import { useCallback, useEffect, useState } from "react";
import type {
  PromptAssetKindCount,
  PromptReferenceItem,
  PromptSourceAsset,
} from "@prompthub/shared/types";

/** Materials shown per page in the asset library. */
export const ASSET_PAGE_SIZE = 48;
/** Thumbnails are read in small batches so the grid fills up progressively. */
export const THUMBNAIL_BATCH_SIZE = 48;

interface AssetLibraryOptions {
  /** Materials marked by the user; the workspace owns them. */
  selectedIds: string[];
  onSelectedIdsChange: (ids: string[]) => void;
}

export interface PromptAssetLibraryState {
  items: PromptSourceAsset[];
  total: number;
  kindCounts: PromptAssetKindCount[];
  kind: string;
  query: string;
  thumbnails: Record<string, string>;
  error: string;
  hasMore: boolean;
  setKind: (kind: string) => void;
  setQuery: (query: string) => void;
  toggle: (id: string) => void;
  clearSelection: () => void;
  loadMore: () => void;
  refresh: () => void;
  refreshKindCounts: () => void;
}

/**
 * Reads the picture library: one page of materials, their pictures and the
 * number of materials per library. The marked materials are owned by the
 * caller, so the workspace can keep them.
 */
export function usePromptAssetLibrary({
  selectedIds,
  onSelectedIdsChange,
}: AssetLibraryOptions): PromptAssetLibraryState {
  const [items, setItems] = useState<PromptSourceAsset[]>([]);
  const [total, setTotal] = useState(0);
  const [kindCounts, setKindCounts] = useState<PromptAssetKindCount[]>([]);
  const [kind, setKind] = useState("");
  const [query, setQuery] = useState("");
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [limit, setLimit] = useState(ASSET_PAGE_SIZE);
  const [refreshToken, setRefreshToken] = useState(0);
  const [error, setError] = useState("");

  /** Reads the material page of the picture library. */
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      void (async () => {
        const reply = await window.api.promptAsset.list({
          ...(kind ? { kind } : {}),
          ...(query.trim() ? { query: query.trim() } : {}),
          limit,
        });
        if (!active) return;
        if (reply.ok !== true) {
          setError(reply.error.message);
          return;
        }
        setError("");
        setItems(reply.data.items);
        setTotal(reply.data.total);
        const ids = reply.data.items.map((item) => item.id);
        if (ids.length === 0) return;
        const pictures = await window.api.promptAsset.thumbnails({ ids });
        if (!active) return;
        if (pictures.ok !== true) {
          setError(pictures.error.message);
          return;
        }
        setThumbnails((current) => ({ ...current, ...pictures.data }));
      })();
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [kind, query, limit, refreshToken]);

  /** Reads the number of materials per library for the filter buttons. */
  const refreshKindCounts = useCallback(async (): Promise<void> => {
    const reply = await window.api.promptAsset.kindCounts();
    if (reply.ok !== true) {
      setError(reply.error.message);
      return;
    }
    setKindCounts(reply.data);
  }, []);

  useEffect(() => {
    void refreshKindCounts();
  }, [refreshKindCounts]);

  function toggle(id: string): void {
    onSelectedIdsChange(
      selectedIds.includes(id)
        ? selectedIds.filter((entry) => entry !== id)
        : [...selectedIds, id],
    );
  }

  return {
    items,
    total,
    kindCounts,
    kind,
    query,
    thumbnails,
    error,
    hasMore: total > items.length,
    setKind,
    setQuery,
    toggle,
    clearSelection: () => onSelectedIdsChange([]),
    loadMore: () => setLimit((current) => current + ASSET_PAGE_SIZE),
    refresh: () => setRefreshToken((current) => current + 1),
    refreshKindCounts,
  };
}

/**
 * Reads the pictures of the imported color cards. The renderer cannot open the
 * read-only source tree, so the main process hands out the pictures.
 */
export function useReferenceThumbnails(
  referenceItems: PromptReferenceItem[],
  onError: (message: string) => void,
): { referenceThumbnails: Record<string, string> } {
  const [referenceThumbnails, setReferenceThumbnails] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    const ids = referenceItems.map((item) => item.id);
    if (ids.length === 0) return () => {
      active = false;
    };
    void (async () => {
      for (let index = 0; index < ids.length; index += THUMBNAIL_BATCH_SIZE) {
        const batch = ids.slice(index, index + THUMBNAIL_BATCH_SIZE);
        const reply = await window.api.promptReference.thumbnails({ ids: batch });
        if (!active) return;
        if (reply.ok !== true) {
          onError(reply.error.message);
          return;
        }
        setReferenceThumbnails((current) => ({ ...current, ...reply.data }));
      }
    })();
    return () => {
      active = false;
    };
  }, [referenceItems, onError]);

  return { referenceThumbnails };
}
