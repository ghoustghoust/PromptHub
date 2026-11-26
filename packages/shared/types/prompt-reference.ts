/**
 * Reference library items (director color cards). They are retrieved style
 * material, not knowledge modules: the UI injects one to three compact style
 * blocks plus a thumbnail, and they never enter the P/S/H writing-layer budget.
 */
export interface PromptReferenceStyleProfile {
  lighting?: string;
  framing?: string;
  grading?: string;
  avoid: string[];
}

export interface PromptReferenceItem {
  id: string;
  nameZh: string;
  nameEn?: string;
  category: string;
  nationality?: string;
  era?: string;
  summary: string;
  /** Main palette hexes in display order. */
  palette: string[];
  style: PromptReferenceStyleProfile;
  /** Absolute path to the local preview image; read-only source asset. */
  thumbnailPath?: string;
  sourcePath: string;
  sourceHash: string;
  createdAt: number;
  updatedAt: number;
}

export interface PromptReferenceItemPreview {
  /** Stable preview key: source path, replaced by a uuid on commit. */
  key: string;
  /** Director identity declared by the source card; absent when it has none. */
  directorId?: string;
  nameZh: string;
  nameEn?: string;
  category: string;
  nationality?: string;
  era?: string;
  summary: string;
  palette: string[];
  style: PromptReferenceStyleProfile;
  thumbnailPath?: string;
  sourcePath: string;
  /** Every source directory that holds this director, primary source first. */
  sourcePaths?: string[];
  sourceHash: string;
}

export interface PromptReferenceImportSkipped {
  path: string;
  reason: string;
}

export type PromptReferenceConflictReason =
  | "missing-director-id"
  | "duplicate-director-id"
  | "divergent-director-content";

/** A card that needs attention but does not block the import. */
export interface PromptReferenceImportConflict {
  path: string;
  reason: PromptReferenceConflictReason;
  /** Director identity involved in the conflict, when the card declares one. */
  directorId?: string;
}

export interface PromptReferenceImportPreview {
  items: PromptReferenceItemPreview[];
  skipped: PromptReferenceImportSkipped[];
  conflicts: PromptReferenceImportConflict[];
  categories: Array<{ name: string; count: number }>;
}

export interface PromptReferenceImportCommitResult {
  itemIds: string[];
  skipped: PromptReferenceImportSkipped[];
  conflicts: PromptReferenceImportConflict[];
}

export interface DesktopPromptReferencePreviewRequest {
  /** Source roots; the cards are merged by their director identity. */
  roots: string[];
}

export interface DesktopPromptReferenceImportRequest {
  roots: string[];
}

export interface DesktopPromptReferenceThumbnailRequest {
  ids: string[];
}