export type PromptMossLayoutLabel = "object" | "text";

/**
 * The model-facing label. Character boxes stay `object` while editing and become
 * `character` here, matching the MOSS-Image Layout Prompt node output.
 */
export type PromptMossLayoutModelLabel = "object" | "text" | "character";

/** Normalized [top, left, bottom, right] coordinates in the 0-1000 editing space. */
export type PromptMossNormalizedBBox = [number, number, number, number];

export interface PromptMossLayoutBox {
  id: string;
  label: PromptMossLayoutLabel;
  /**
   * Visual description of this element, not a replacement for exact text.
   * May be empty: the orchestrator fills or polishes it before compiling.
   */
  caption: string;
  /** Exact visible text; required only when label is text. */
  text?: string;
  /** Object boxes marked as characters are reported as 1-based draw-order numbers. */
  character?: boolean;
  /** Marked when reverse-engineered text may be a misread and needs human review. */
  needsReview?: boolean;
  bbox: PromptMossNormalizedBBox;
}

/** Editable PromptHub layout. Coordinates stay resolution-independent. */
export interface PromptMossLayoutDraft {
  version: 1;
  canvas: { width: number; height: number };
  /** Draw order is significant: background first, foreground last. */
  boxes: PromptMossLayoutBox[];
}

export interface PromptMossLayoutModelItem {
  label: PromptMossLayoutModelLabel;
  caption: string;
  text?: string;
  /** Absolute center-origin pixels in [top, left, bottom, right] order. */
  bbox: [number, number, number, number];
}

export interface PromptMossLayoutModelPrompt {
  summary: {
    /** Optional medium/genre tags; omitted unless explicitly supplied. */
    meta?: string[];
    /** Documented in USERGUIDE_ZH; the ComfyUI node emits a caption-only summary. */
    canvas: "single";
    caption: string;
  };
  items: PromptMossLayoutModelItem[];
  bbox_coord_space: "abs_centralized";
  bbox_format: "yxyx";
}

export interface PromptMossLayoutResult {
  draft: PromptMossLayoutDraft;
  modelPrompt: PromptMossLayoutModelPrompt;
  /** 1-based object-box positions for the downstream character_boxes setting. */
  characterBoxes: number[];
  /** 0-based box indexes whose visual description is still empty. */
  pendingCaptions: number[];
}

/** Result of filling or polishing per-box visual descriptions. */
export interface PromptMossCaptionRefinement {
  captions: string[];
  status: "complete" | "degraded";
  warnings: string[];
}

/** Result of reversing a poster/reference image into an editable layout. */
export interface PromptMossLayoutReverse {
  draft: PromptMossLayoutDraft;
  summary: string;
  status: "complete" | "degraded";
  warnings: string[];
}
