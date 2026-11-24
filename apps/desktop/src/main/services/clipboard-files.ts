import path from "node:path";
import { fileURLToPath } from "node:url";

const DROPFILES_HEADER = 20;

/**
 * Parses a Windows CF_HDROP/FileNameW payload. Explorer copies use a DROPFILES
 * header followed by a UTF-16 path list, while some apps store a bare list, so
 * both shapes are accepted; the header is only trusted when its offset is sane.
 */
export function parseDropFiles(buffer: Buffer): string[] {
  if (buffer.length < DROPFILES_HEADER) return [];
  const offset = buffer.readUInt32LE(0);
  const wide = buffer.readUInt32LE(16) !== 0;
  if (offset < DROPFILES_HEADER || offset >= buffer.length) return [];
  const payload = buffer.subarray(offset);
  const text = wide ? payload.toString("utf16le") : payload.toString("latin1");
  return text
    .split("\0")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** Accepts a bare path, a quoted path, or a file:// URI; anything else is ignored. */
export function normalizeClipboardPath(value: string): string | null {
  const text = value.trim().replace(/^"(.*)"$/, "$1").trim();
  if (!text) return null;
  if (text.startsWith("file://")) {
    try {
      return fileURLToPath(text);
    } catch {
      return null;
    }
  }
  // Explorer can quote a path; a stray leading/trailing quote must not defeat detection.
  const unquoted = text.replace(/^'+|'+$/g, "").trim();
  return path.isAbsolute(unquoted) ? unquoted : null;
}

export interface ClipboardPathSources {
  fileNameW?: Buffer | null;
  fileName?: Buffer | null;
  uriList?: string | null;
  text?: string | null;
}

/**
 * Ordered, de-duplicated path candidates from the clipboard. The caller tries
 * each one as an image instead of assuming the first entry is usable.
 */
export function extractClipboardPaths(sources: ClipboardPathSources): string[] {
  const candidates: string[] = [];
  const push = (value: string | null): void => {
    const normalized = value ? normalizeClipboardPath(value) : null;
    if (normalized) candidates.push(normalized);
  };

  if (sources.fileNameW?.length) {
    const paths = parseDropFiles(sources.fileNameW);
    const raw = paths.length > 0
      ? paths
      : sources.fileNameW.toString("utf16le").split("\0");
    raw.forEach(push);
  }
  if (sources.fileName?.length) {
    parseDropFiles(sources.fileName).forEach(push);
  }
  for (const line of (sources.uriList ?? "").split(/\r?\n/)) {
    if (line.trim() && !line.trim().startsWith("#")) push(line.trim());
  }
  for (const line of (sources.text ?? "").split(/\r?\n/)) {
    if (line.trim()) push(line.trim());
  }
  return [...new Set(candidates)];
}
