import fs from "node:fs";
import path from "node:path";
import { nativeImage } from "electron";

/** Width of the picture the renderer shows; the source file stays untouched. */
const THUMBNAIL_WIDTH = 320;
const JPEG_QUALITY = 72;
/** A source file above this size is not read into the renderer. */
const MAX_SOURCE_BYTES = 16 * 1024 * 1024;

const MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

/**
 * The renderer cannot read the read-only source tree, so the main process
 * hands out a small picture per record. Large sources are scaled down; small
 * ones are returned unchanged.
 */
export function readLibraryThumbnail(filePath: string): string | null {
  const extension = path.extname(filePath).toLowerCase();
  const mimeType = MIME_TYPES[extension];
  if (!mimeType) return null;
  let stats: fs.Stats;
  try {
    stats = fs.statSync(filePath);
  } catch {
    return null;
  }
  if (!stats.isFile() || stats.size > MAX_SOURCE_BYTES) return null;

  const image = nativeImage.createFromPath(filePath);
  if (!image.isEmpty()) {
    const resized = image.getSize().width > THUMBNAIL_WIDTH
      ? image.resize({ width: THUMBNAIL_WIDTH, quality: "good" })
      : image;
    const encoded = resized.toJPEG(JPEG_QUALITY);
    if (encoded.length > 0) {
      return `data:image/jpeg;base64,${encoded.toString("base64")}`;
    }
  }
  try {
    const bytes = fs.readFileSync(filePath);
    return `data:${mimeType};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

/**
 * Reads the thumbnails of several records at once. Records without a readable
 * picture are simply missing from the result.
 */
export function readLibraryThumbnails(
  entries: Array<{ id: string; path: string | null | undefined }>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of entries) {
    if (!entry.path) continue;
    const dataUrl = readLibraryThumbnail(entry.path);
    if (dataUrl) result[entry.id] = dataUrl;
  }
  return result;
}
