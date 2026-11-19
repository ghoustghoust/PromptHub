import { randomUUID } from "node:crypto";
import type {
  PromptMossCaptionRefinement,
  PromptMossLayoutBox,
  PromptMossLayoutDraft,
  PromptMossLayoutLabel,
  PromptMossLayoutReverse,
  PromptMossNormalizedBBox,
} from "@prompthub/shared/types";
import type { PromptOrchestratorLlm } from "./prompt-orchestrator-llm";

const MAX_BOXES = 32;
const MAX_CAPTION = 600;
const MAX_TEXT = 4000;
/** A 20-box layout JSON easily exceeds a caption-sized budget. */
const LAYOUT_OUTPUT_TOKENS = 4096;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(content: string): Record<string, unknown> {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const raw = fenced?.[1] ?? trimmed;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Layout assistant output was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isRecord(parsed)) throw new Error("Layout assistant output must be a JSON object");
  return parsed;
}

function cleanCaption(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, MAX_CAPTION);
}

function cleanText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, MAX_TEXT);
}

/**
 * Accepts 0-1000 normalized yxyx, and tolerates a 0-1 float guess.
 * Returns null when the rectangle is unusable.
 */
export function normalizeLayoutBBox(value: unknown): PromptMossNormalizedBBox | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  if (!value.every((entry) => typeof entry === "number" && Number.isFinite(entry))) {
    return null;
  }
  const numbers = value as number[];
  const scale = numbers.every((entry) => entry >= 0 && entry <= 1) ? 1000 : 1;
  const scaled = numbers.map((entry) => Math.round(Math.min(1000, Math.max(0, entry * scale))));
  const [top, left, bottom, right] = scaled;
  if (top >= bottom || left >= right) return null;
  return [top, left, bottom, right];
}

/**
 * Models routinely answer with free-form labels (background, title_bar, character).
 * MOSS only accepts object/text, so anything that is not lettering becomes an object
 * instead of being dropped as an invalid box.
 */
function parseLabel(value: unknown): PromptMossLayoutLabel {
  if (typeof value !== "string") return "object";
  const normalized = value.trim().toLowerCase();
  return normalized === "text" || normalized === "typography" || normalized === "lettering"
    ? "text"
    : "object";
}

export interface MossLayoutCaptionRequest {
  draft: PromptMossLayoutDraft;
  intent?: string;
  llm: PromptOrchestratorLlm;
}

const CAPTION_SYSTEM = [
  "You refine per-box visual descriptions for a MOSS-Image Layout JSON prompt inside PromptHub.",
  "Return one JSON object only, with no Markdown fences and no commentary:",
  '{ "captions": ["description for box 1", "description for box 2"] }',
  "Rules:",
  "- Emit exactly one caption per input box, in the same order. The array length must match the box count.",
  "- A caption is a compact phrase about what is drawn inside that box: subject appearance, clothing, material, colour, lighting, camera angle, pose, or typography style. 25-80 words is enough.",
  "- Empty input captions must be filled from the overall intent and the box role. Never leave a caption empty.",
  "- Existing captions that already fit should be kept in meaning and only tightened; do not invent a different subject.",
  "- Text boxes describe layout and typography (font weight, alignment, colour, decorative treatment). Do not repeat the exact wording as prose unless the wording itself is drawn as an art object.",
  "- Never output coordinates, box indexes, JSON escapes, labels like 'this box', or meta commentary.",
].join("\n");

export async function refineMossLayoutCaptions(
  request: MossLayoutCaptionRequest,
): Promise<PromptMossCaptionRefinement> {
  const boxes = request.draft.boxes;
  if (boxes.length === 0) {
    return { captions: [], status: "degraded", warnings: ["The canvas has no boxes to describe."] };
  }
  const user = JSON.stringify({
    intent: request.intent?.trim() || null,
    canvas: request.draft.canvas,
    boxes: boxes.map((box, index) => ({
      index: index + 1,
      label: box.label,
      exactText: box.label === "text" ? box.text ?? "" : null,
      currentCaption: box.caption.trim() || null,
    })),
  });
  try {
    const content = await request.llm.complete({
      messages: { system: CAPTION_SYSTEM, user },
      mode: "polish",
      maxTokens: LAYOUT_OUTPUT_TOKENS,
    });
    const parsed = parseJson(content);
    const raw = parsed.captions;
    if (!Array.isArray(raw) || raw.length !== boxes.length) {
      throw new Error("Layout assistant must return exactly one caption per box");
    }
    const captions = raw.map((entry, index) => {
      const caption = cleanCaption(entry);
      if (!caption) throw new Error(`Layout assistant caption ${index + 1} is empty`);
      return caption;
    });
    return { captions, status: "complete", warnings: [] };
  } catch (error) {
    const fallback = boxes.map((box) => box.caption.trim());
    return {
      captions: fallback,
      status: "degraded",
      warnings: [
        `Per-box descriptions were not refined: ${error instanceof Error ? error.message : String(error)}`,
        ...(fallback.some((caption) => !caption)
          ? ["Some boxes still have no visual description; edit them manually or retry."]
          : []),
      ],
    };
  }
}

export interface MossLayoutReverseRequest {
  images: string[];
  canvas: PromptMossLayoutDraft["canvas"];
  intent?: string;
  llm: PromptOrchestratorLlm;
}

const REVERSE_SYSTEM = [
  "You reverse-engineer an editable poster or graphic layout into MOSS-Image Layout boxes.",
  "Return one JSON object only, with no Markdown fences and no commentary:",
  '{ "summary": "one sentence describing the whole image", "boxes": [ { "label": "object", "caption": "visual description", "bbox": [top, left, bottom, right] } ] }',
  "Rules:",
  "- Coordinates are normalized 0-1000 on the yxyx order (top, left, bottom, right) and must satisfy top < bottom, left < right.",
  "- Order boxes as draw order: full-bleed background first, then large subjects, then details, text last.",
  "- label must be exactly \"object\" or \"text\". Never invent other words such as background, title_bar or character.",
  "- For a text box add \"text\" with the exact characters you can read, preserving case, punctuation and line breaks. If any character is uncertain, write your best guess, put ? in place of the unreadable character, and set \"needsReview\": true.",
  "- Never invent copy that is not printed in the image. If lettering is unreadable, mark needsReview instead of guessing a plausible slogan.",
  "- Every object box needs a caption describing only what is visible: subject, clothing, material, colour, lighting, camera angle, typography style.",
  `- Use at most ${MAX_BOXES} boxes. Do not return pixel coordinates or extra keys.`,
].join("\n");

function parseReverseBoxes(value: unknown, warnings: string[]): PromptMossLayoutBox[] {
  if (!Array.isArray(value)) throw new Error("Reverse layout boxes must be an array");
  const boxes: PromptMossLayoutBox[] = [];
  value.slice(0, MAX_BOXES).forEach((entry, index) => {
    if (!isRecord(entry)) {
      warnings.push(`Box ${index + 1} was ignored because it is not an object.`);
      return;
    }
    const label = parseLabel(entry.label);
    const bbox = normalizeLayoutBBox(entry.bbox);
    if (!bbox) {
      warnings.push(`Box ${index + 1} was ignored because its rectangle is invalid.`);
      return;
    }
    const text = label === "text" ? cleanText(entry.text) : "";
    if (label === "text" && !text) {
      warnings.push(`Text box ${index + 1} was ignored because no readable text was returned.`);
      return;
    }
    const caption = cleanCaption(entry.caption);
    if (!caption) {
      warnings.push(`Box ${index + 1} has no visual description yet.`);
    }
    boxes.push({
      id: randomUUID(),
      label,
      caption,
      ...(label === "text" ? { text } : {}),
      ...(entry.needsReview === true || text.includes("?") ? { needsReview: true } : {}),
      bbox,
    });
  });
  return boxes;
}

export async function reverseMossLayoutFromImages(
  request: MossLayoutReverseRequest,
): Promise<PromptMossLayoutReverse> {
  const images = request.images.filter((image) => image.trim().length > 0).slice(0, 4);
  if (images.length === 0) {
    return {
      draft: { version: 1, canvas: request.canvas, boxes: [] },
      summary: "",
      status: "degraded",
      warnings: ["Select at least one reference image first."],
    };
  }
  const user = JSON.stringify({
    intent: request.intent?.trim() || null,
    canvas: request.canvas,
    imageCount: images.length,
    instruction:
      "Read the attached poster or graphic and return the layout boxes. Keep printed text verbatim; mark uncertain characters.",
  });
  try {
    const content = await request.llm.complete({
      messages: { system: REVERSE_SYSTEM, user },
      mode: "reverse",
      imageUrls: images,
      maxTokens: LAYOUT_OUTPUT_TOKENS,
    });
    const parsed = parseJson(content);
    const warnings: string[] = [];
    const boxes = parseReverseBoxes(parsed.boxes, warnings);
    if (boxes.length === 0) {
      throw new Error("No usable layout box was recognized in the image");
    }
    const summary = cleanText(parsed.summary);
    return {
      draft: { version: 1, canvas: request.canvas, boxes },
      summary,
      status: warnings.length > 0 ? "degraded" : "complete",
      warnings,
    };
  } catch (error) {
    return {
      draft: { version: 1, canvas: request.canvas, boxes: [] },
      summary: "",
      status: "degraded",
      warnings: [
        `Layout reverse failed: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
}
