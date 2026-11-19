import type {
  PromptMossLayoutBox,
  PromptMossLayoutDraft,
  PromptMossLayoutModelItem,
  PromptMossLayoutResult,
  PromptMossNormalizedBBox,
} from "@prompthub/shared/types";

const MAX_LAYOUT_BOXES = 32;
const MAX_LAYOUT_TEXT = 4000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validText(value: unknown, allowEmpty = false): value is string {
  return (
    typeof value === "string" &&
    (allowEmpty || value.trim().length > 0) &&
    value.length <= MAX_LAYOUT_TEXT &&
    !value.includes("\0")
  );
}

function validDimension(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0 &&
    value % 16 === 0
  );
}

function validBBox(value: unknown): value is PromptMossNormalizedBBox {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every(
      (entry) =>
        typeof entry === "number" &&
        Number.isFinite(entry) &&
        entry >= 0 &&
        entry <= 1000,
    ) &&
    value[0] < value[2] &&
    value[1] < value[3]
  );
}

/** Returns a boundary-safe validation message instead of trusting IPC types. */
export function mossLayoutValidationError(value: unknown): string | null {
  if (!isRecord(value) || value.version !== 1) {
    return "layout.version must be 1";
  }
  if (!isRecord(value.canvas)) return "layout.canvas is required";
  if (!validDimension(value.canvas.width) || !validDimension(value.canvas.height)) {
    return "Layout canvas dimensions must be positive multiples of 16";
  }
  if (!Array.isArray(value.boxes) || value.boxes.length < 1) {
    return "MOSS layout requires at least one box";
  }
  if (value.boxes.length > MAX_LAYOUT_BOXES) {
    return `MOSS layout supports at most ${MAX_LAYOUT_BOXES} boxes`;
  }
  const ids = new Set<string>();
  for (let index = 0; index < value.boxes.length; index += 1) {
    const box: unknown = value.boxes[index];
    const label = `layout.boxes[${index}]`;
    if (!isRecord(box)) return `${label} must be an object`;
    if (!validText(box.id) || box.id.length > 128) return `${label}.id is invalid`;
    if (ids.has(box.id)) return `${label}.id must be unique`;
    ids.add(box.id);
    if (box.label !== "object" && box.label !== "text") {
      return `${label}.label must be object or text`;
    }
    if (!validText(box.caption, true)) return `${label}.caption is invalid`;
    if (box.label === "text" && !validText(box.text)) {
      return `${label}.text is required for a text box`;
    }
    if (box.text !== undefined && !validText(box.text, true)) {
      return `${label}.text is invalid`;
    }
    if (box.character !== undefined && typeof box.character !== "boolean") {
      return `${label}.character must be a boolean`;
    }
    if (box.needsReview !== undefined && typeof box.needsReview !== "boolean") {
      return `${label}.needsReview must be a boolean`;
    }
    if (!validBBox(box.bbox)) {
      return `${label}.bbox must be normalized yxyx coordinates from 0 to 1000`;
    }
  }
  return null;
}

function centeredPixel(
  value: number,
  extent: number,
  edge: "min" | "max",
): number {
  const scaled = (value / 1000) * extent;
  const pixel = edge === "min" ? Math.floor(scaled) : Math.ceil(scaled);
  return pixel - extent / 2;
}

function compileBox(
  box: PromptMossLayoutBox,
  caption: string,
  canvas: PromptMossLayoutDraft["canvas"],
): PromptMossLayoutModelItem {
  const [top, left, bottom, right] = box.bbox;
  const label: PromptMossLayoutModelItem["label"] =
    box.label === "text" ? "text" : box.character === true ? "character" : "object";
  return {
    label,
    caption: caption.trim(),
    ...(label === "text" ? { text: box.text } : {}),
    bbox: [
      centeredPixel(top, canvas.height, "min"),
      centeredPixel(left, canvas.width, "min"),
      centeredPixel(bottom, canvas.height, "max"),
      centeredPixel(right, canvas.width, "max"),
    ],
  };
}

/**
 * Compiles normalized editing boxes into the exact model-facing MOSS JSON.
 * Only text descriptions are variable; geometry and exact text come from the draft.
 */
export function compileMossLayout(
  draft: PromptMossLayoutDraft,
  summaryCaption: string,
  captions?: string[],
): PromptMossLayoutResult {
  const validationError = mossLayoutValidationError(draft);
  if (validationError) throw new Error(validationError);
  if (!validText(summaryCaption)) throw new Error("Layout summary caption is required");
  if (captions !== undefined && captions.length !== draft.boxes.length) {
    throw new Error("layoutCaptions must contain exactly one caption per layout box");
  }
  const items = draft.boxes.map((box, index) => {
    const refined = captions?.[index]?.trim();
    const caption = refined || box.caption.trim();
    return compileBox(box, caption, draft.canvas);
  });
  const pendingCaptions = items.flatMap((item, index) =>
    item.caption.length > 0 ? [] : [index],
  );
  return {
    draft,
    modelPrompt: {
      summary: {
        canvas: "single",
        caption: summaryCaption.trim(),
      },
      items,
      bbox_coord_space: "abs_centralized",
      bbox_format: "yxyx",
    },
    characterBoxes: draft.boxes.flatMap((box, index) =>
      box.label === "object" && box.character === true ? [index + 1] : [],
    ),
    pendingCaptions,
  };
}

export function serializeMossLayout(layout: PromptMossLayoutResult): string {
  return JSON.stringify(layout.modelPrompt);
}
