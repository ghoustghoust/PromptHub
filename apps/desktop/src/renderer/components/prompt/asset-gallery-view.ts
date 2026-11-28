import type { PromptSourceAsset } from "@prompthub/shared/types";

/** Per-library subtitle: the field that actually tells one record from another. */
export function assetSubtitle(asset: PromptSourceAsset): string {
  const meta = asset.meta ?? {};
  const text = (key: string): string =>
    typeof meta[key] === "string" ? (meta[key] as string).trim() : "";
  if (asset.kind === "costume") return text("category");
  if (asset.kind === "hair" || asset.kind === "portrait") {
    return text("sectionZh") || text("section");
  }
  if (asset.kind === "pose") {
    return [text("group"), text("poseNumber"), text("angle")].filter(Boolean).join(" · ");
  }
  return "";
}

/** Primitive metadata for the detail view; pictures and ids are shown elsewhere. */
export function assetMetaEntries(asset: PromptSourceAsset): Array<{ key: string; value: string }> {
  const meta = asset.meta ?? {};
  return Object.entries(meta)
    .filter(([key]) => key !== "thumbnail" && key !== "sourceIndex")
    .flatMap(([key, value]) => {
      if (typeof value === "string" && value.trim()) return [{ key, value: value.trim() }];
      if (typeof value === "number") return [{ key, value: String(value) }];
      if (Array.isArray(value) && value.length > 0) {
        return [{ key, value: value.filter((item) => typeof item === "string").join(", ") }];
      }
      return [];
    });
}

/** "25–48 / 5,238" for the footer; a single page shows its own count. */
export function assetPageRange(offset: number, count: number, total: number): string {
  if (total === 0) return "0 / 0";
  if (count === 0) return `${total}`;
  return `${offset + 1}–${offset + count} / ${total}`;
}