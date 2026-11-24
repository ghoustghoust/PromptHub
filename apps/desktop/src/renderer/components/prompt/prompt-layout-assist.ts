import type { PromptMossLayoutBox } from "@prompthub/shared/types";

/**
 * Maps positional captions back to the boxes that were actually requested.
 *
 * The refinement API answers with one caption per box in request order, so the
 * caller snapshots the ids before sending. A box that was added, removed or
 * reordered while the request was in flight can never receive another box's
 * caption: unknown ids are skipped and new boxes stay untouched.
 */
export function applyCaptionsToBoxes(
  boxes: PromptMossLayoutBox[],
  requestedIds: readonly string[],
  captions: readonly string[],
): PromptMossLayoutBox[] {
  if (requestedIds.length === 0 || captions.length === 0) return boxes;
  const captionsById = new Map<string, string>();
  requestedIds.forEach((id, index) => {
    const caption = captions[index]?.trim();
    if (caption) captionsById.set(id, caption);
  });
  if (captionsById.size === 0) return boxes;
  let changed = false;
  const next = boxes.map((box) => {
    const caption = captionsById.get(box.id);
    if (!caption || caption === box.caption) return box;
    changed = true;
    return { ...box, caption };
  });
  return changed ? next : boxes;
}