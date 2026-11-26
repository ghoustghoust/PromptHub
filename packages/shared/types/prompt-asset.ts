import type { PromptSourceAsset } from "./prompt-vocab";

/**
 * Read-only source assets (image libraries). The rows live in `source_assets`
 * and only point at the original picture; the picture itself stays in the
 * read-only source directory and never enters the database or an export.
 */
export interface PromptAssetImportItem {
  id: string;
  kind: string;
  path: string;
  title: string;
  meta: Record<string, unknown>;
}

export interface PromptAssetImportSkipped {
  /** Record id or source path of the skipped entry. */
  id: string;
  reason: string;
}

export type PromptAssetConflictReason =
  | "missing-source-relation"
  | "duplicate-id"
  | "divergent-content";

export interface PromptAssetImportConflict {
  id: string;
  kind: string;
  reason: PromptAssetConflictReason;
  /** The relation or value that could not be resolved. */
  detail?: string;
}

export interface PromptAssetImportPreview {
  items: PromptAssetImportItem[];
  skipped: PromptAssetImportSkipped[];
  conflicts: PromptAssetImportConflict[];
  /** Item count per library. */
  counts: Record<string, number>;
}

export interface PromptAssetImportCommitResult {
  assetIds: string[];
  inserted: number;
  updated: number;
  skipped: PromptAssetImportSkipped[];
  conflicts: PromptAssetImportConflict[];
}

export interface PromptAssetQuery {
  /** Restrict the result to one library. */
  kind?: string;
  /** Case-insensitive text matched against the id, the title and the metadata. */
  query?: string;
  limit?: number;
  offset?: number;
}

export interface PromptAssetQueryResult {
  items: PromptSourceAsset[];
  /** Total number of matching rows, not the page size. */
  total: number;
}

export interface PromptAssetKindCount {
  kind: string;
  count: number;
}

export interface DesktopPromptAssetPreviewRequest {
  rootPath: string;
}

export interface DesktopPromptAssetImportRequest {
  rootPath: string;
}

export interface DesktopPromptAssetListRequest {
  kind?: string;
  query?: string;
  limit?: number;
  offset?: number;
}

export interface DesktopPromptAssetThumbnailRequest {
  ids: string[];
}

export type PromptAssetIPCReply<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };
