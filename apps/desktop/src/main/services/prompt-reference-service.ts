import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { PromptReferenceDB } from "@prompthub/db";
import type {
  PromptReferenceImportCommitResult,
  PromptReferenceImportConflict,
  PromptReferenceImportPreview,
  PromptReferenceImportSkipped,
  PromptReferenceItem,
  PromptReferenceItemPreview,
  PromptReferenceStyleProfile,
} from "@prompthub/shared/types";

const PALETTE_DIR = path.join("assets", "color_palettes");
const MANIFEST_PATH = path.join("assets", "references", "reference_director_manifest.json");
const MAIN_DOC = "色卡主文档.md";
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const CATEGORY_PREFIX = /^\d+[_-]/;

/**
 * Thumbnail candidates in a fixed order. The first candidate that exists in
 * any source of a director wins; inside one candidate the earlier root wins.
 */
const THUMBNAIL_PRIORITY = [
  "palette_main.png",
  "影调色卡.png",
  "palette_vertical.png",
  "reference_palette.png",
  "frames-contact-sheet.jpg",
];
const PALETTE_FALLBACK_RANK = 1000;
const STILL_FALLBACK_RANK = 1001;

interface PaletteJson {
  director?: {
    /** Director identity of the source library; the only stable merge key. */
    id?: string;
    name_en?: string;
    name_zh?: string;
    category?: string;
    nationality?: string;
    active_years?: string;
    era?: string;
  };
  palette?: {
    primary?: Array<{ hex?: string }>;
  };
}

interface ManifestJson {
  director?: { zh?: string; en?: string };
  style_profile?: {
    definition?: string;
    lighting?: string;
    framing?: string;
    grading?: string;
    avoid?: string[];
  };
}

function hashText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Sorts object keys so a formatting-only difference keeps the same hash. */
function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, canonicalValue(record[key])]),
    );
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value)) ?? "";
}

/** Line endings and trailing spaces never count as a content change. */
function normalizeText(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

function readTextIfExists(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

/**
 * Hash of the card content. The two color-card libraries hold the same
 * director with different formatting, so the hash uses canonical JSON and
 * normalized text; only a real content change changes the hash.
 */
function sourceContentHash(directorDir: string): string {
  const palette = readJson<unknown>(path.join(directorDir, PALETTE_DIR, "palette.json"));
  const manifest = readJson<unknown>(path.join(directorDir, MANIFEST_PATH));
  const doc = readTextIfExists(path.join(directorDir, MAIN_DOC));
  return hashText([canonicalJson(palette), canonicalJson(manifest), normalizeText(doc)].join("\n"));
}

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function stripCategoryPrefix(value: string): string {
  return value.replace(CATEGORY_PREFIX, "").trim() || value;
}

function imagesIn(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory)
    .filter((entry) => IMAGE_EXTENSIONS.has(path.extname(entry).toLowerCase()))
    .sort()
    .map((entry) => path.join(directory, entry));
}

interface ThumbnailCandidate {
  path: string;
  /** Lower is better; the priority list comes before the fallbacks. */
  rank: number;
}

/** Best thumbnail of one source, chosen by the fixed priority list. */
function thumbnailFor(directorDir: string): ThumbnailCandidate | undefined {
  const paletteDir = path.join(directorDir, PALETTE_DIR);
  for (let index = 0; index < THUMBNAIL_PRIORITY.length; index += 1) {
    const candidate = path.join(paletteDir, THUMBNAIL_PRIORITY[index]);
    if (fs.existsSync(candidate)) return { path: candidate, rank: index };
  }
  const paletteImages = imagesIn(paletteDir);
  if (paletteImages.length > 0) return { path: paletteImages[0], rank: PALETTE_FALLBACK_RANK };
  const stills = imagesIn(path.join(directorDir, "assets", "film_stills"));
  if (stills.length > 0) return { path: stills[0], rank: STILL_FALLBACK_RANK };
  return undefined;
}

function summaryFromMainDoc(directorDir: string): string {
  const doc = path.join(directorDir, MAIN_DOC);
  if (!fs.existsSync(doc)) return "";
  const text = fs.readFileSync(doc, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(">")) continue;
    const body = trimmed.slice(1).trim();
    if (!body || body.includes("**")) continue;
    return body;
  }
  // Some cards write the one-line style as plain text under the heading.
  const section = /##\s*[^\n]*核心风格一句话[^\n]*\n([\s\S]*?)(?=\n##|$)/.exec(text);
  const fallback = section?.[1]
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#") && !line.startsWith(">") && !line.startsWith("---"));
  return fallback?.replace(/^[-*]\s*/, "") ?? "";
}

/** Older cards have no manifest; their palette document still names the look. */
function styleFromMainDoc(directorDir: string): Partial<PromptReferenceStyleProfile> {
  const doc = path.join(directorDir, MAIN_DOC);
  if (!fs.existsSync(doc)) return {};
  const text = fs.readFileSync(doc, "utf8");
  const section = (heading: string): string | undefined => {
    const match = new RegExp(
      `###\\s*${heading}[^\\n]*\\n([\\s\\S]*?)(?=\\n###|\\n---|\\n##|$)`,
    ).exec(text);
    const value = match?.[1]
      ?.split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    return value || undefined;
  };
  const grading = section("光影特征");
  return {
    ...(section("色彩与光影") ? { lighting: section("色彩与光影") } : {}),
    ...(section("构图与运镜") ? { framing: section("构图与运镜") } : {}),
    ...(grading ? { grading } : {}),
  };
}

interface ScannedDirector {
  item: PromptReferenceItemPreview;
  thumbnail?: ThumbnailCandidate;
}

function scanDirector(
  categoryDir: string,
  directorName: string,
  skipped: PromptReferenceImportSkipped[],
): ScannedDirector | null {
  const directorDir = path.join(categoryDir, directorName);
  const palettePath = path.join(directorDir, PALETTE_DIR, "palette.json");
  if (!fs.existsSync(palettePath)) {
    skipped.push({ path: directorDir, reason: "palette.json is missing" });
    return null;
  }
  const palette = readJson<PaletteJson>(palettePath);
  if (!palette?.director) {
    skipped.push({ path: directorDir, reason: "palette.json has no director block" });
    return null;
  }
  const manifestPath = path.join(directorDir, MANIFEST_PATH);
  const manifest = readJson<ManifestJson>(manifestPath);
  const profile = manifest?.style_profile;
  const summary = profile?.definition?.trim() || summaryFromMainDoc(directorDir);
  if (!summary) {
    skipped.push({ path: directorDir, reason: "no style definition found" });
    return null;
  }

  const category = stripCategoryPrefix(palette.director.category ?? path.basename(categoryDir));
  const fallbackStyle =
    profile?.lighting && profile.framing && profile.grading
      ? {}
      : styleFromMainDoc(directorDir);
  const style: PromptReferenceStyleProfile = {
    ...(profile?.lighting ?? fallbackStyle.lighting
      ? { lighting: profile?.lighting ?? fallbackStyle.lighting }
      : {}),
    ...(profile?.framing ?? fallbackStyle.framing
      ? { framing: profile?.framing ?? fallbackStyle.framing }
      : {}),
    ...(profile?.grading ?? fallbackStyle.grading
      ? { grading: profile?.grading ?? fallbackStyle.grading }
      : {}),
    avoid: Array.isArray(profile?.avoid)
      ? profile.avoid.filter((entry): entry is string => typeof entry === "string")
      : [],
  };
  const thumbnail = thumbnailFor(directorDir);
  const directorId = palette.director.id?.trim();
  return {
    thumbnail,
    item: {
      key: directorDir,
      ...(directorId ? { directorId } : {}),
      nameZh: palette.director.name_zh ?? manifest?.director?.zh ?? directorName,
      ...(palette.director.name_en ?? manifest?.director?.en
        ? { nameEn: palette.director.name_en ?? manifest?.director?.en }
        : {}),
      category,
      ...(palette.director.nationality ? { nationality: palette.director.nationality } : {}),
      ...(palette.director.active_years
        ? { era: palette.director.active_years }
        : palette.director.era ? { era: palette.director.era } : {}),
      summary,
      palette: (palette.palette?.primary ?? [])
        .map((entry) => entry.hex)
        .filter((hex): hex is string => typeof hex === "string" && /^#[0-9a-fA-F]{6}$/.test(hex)),
      ...(thumbnail ? { thumbnailPath: thumbnail.path } : {}),
      sourcePath: directorDir,
      sourceHash: sourceContentHash(directorDir),
      style,
    },
  };
}

/**
 * Scans the color-card library and returns what an import would write. With
 * several roots the cards are merged by their director identity: the first
 * root provides the metadata, every root may contribute the thumbnail, and a
 * director whose content differs between the roots is reported instead of
 * being merged silently.
 */
export function previewReferenceLibrary(
  rootPaths: string | string[],
): PromptReferenceImportPreview {
  const roots = (Array.isArray(rootPaths) ? rootPaths : [rootPaths]).map((value) =>
    path.resolve(value),
  );
  for (const root of roots) {
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      throw new Error(`Reference library root is not a directory: ${root}`);
    }
  }
  const skipped: PromptReferenceImportSkipped[] = [];
  const conflicts: PromptReferenceImportConflict[] = [];
  const items: PromptReferenceItemPreview[] = [];
  const byDirectorId = new Map<string, number>();
  /** Rank of the thumbnail each merged item currently uses. */
  const thumbnailRanks = new Map<number, number>();
  for (const root of roots) {
    for (const categoryName of fs.readdirSync(root).sort()) {
      const categoryDir = path.join(root, categoryName);
      if (!fs.statSync(categoryDir).isDirectory()) continue;
      for (const directorName of fs.readdirSync(categoryDir).sort()) {
        const directorDir = path.join(categoryDir, directorName);
        if (!fs.statSync(directorDir).isDirectory()) continue;
        const scanned = scanDirector(categoryDir, directorName, skipped);
        if (!scanned) continue;
        const { item, thumbnail } = scanned;
        if (!item.directorId) {
          // The card is still importable, but it carries no merge identity.
          conflicts.push({ path: item.sourcePath, reason: "missing-director-id" });
          items.push(item);
          continue;
        }
        const mergedIndex = byDirectorId.get(item.directorId);
        if (mergedIndex === undefined) {
          byDirectorId.set(item.directorId, items.length);
          items.push(item);
          if (thumbnail) thumbnailRanks.set(items.length - 1, thumbnail.rank);
          continue;
        }
        const merged = items[mergedIndex];
        const sourcePaths = merged.sourcePaths ?? [merged.sourcePath];
        if (!sourcePaths.includes(item.sourcePath)) sourcePaths.push(item.sourcePath);
        merged.sourcePaths = sourcePaths;
        if (merged.sourceHash !== item.sourceHash) {
          conflicts.push({
            path: item.sourcePath,
            reason: "divergent-director-content",
            directorId: item.directorId,
          });
        }
        const currentRank = thumbnailRanks.get(mergedIndex) ?? Number.MAX_SAFE_INTEGER;
        if (thumbnail && thumbnail.rank < currentRank) {
          merged.thumbnailPath = thumbnail.path;
          thumbnailRanks.set(mergedIndex, thumbnail.rank);
        }
      }
    }
  }
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
  return {
    items,
    skipped,
    conflicts,
    categories: [...counts].map(([name, count]) => ({ name, count })),
  };
}

/**
 * Writes the scanned metadata; images stay in the read-only source tree. A
 * card imported before keeps its record id and creation time, so a saved
 * selection still resolves after the source was re-imported.
 */
export function commitReferenceImport(
  db: PromptReferenceDB,
  preview: PromptReferenceImportPreview,
): PromptReferenceImportCommitResult {
  const now = Date.now();
  const items: PromptReferenceItem[] = preview.items.map((item) => {
    // A card imported from any of its sources keeps that record.
    const existing =
      db.findBySourcePath(item.sourcePath) ??
      (item.sourcePaths ?? [])
        .map((sourcePath) => db.findBySourcePath(sourcePath))
        .find((record): record is PromptReferenceItem => record !== null);
    if (existing && existing.sourcePath !== item.sourcePath) {
      // The card moved to another source; the old row must not stay behind.
      db.remove(existing.id);
    }
    return {
      id: existing?.id ?? crypto.randomUUID(),
      nameZh: item.nameZh,
      ...(item.nameEn ? { nameEn: item.nameEn } : {}),
      category: item.category,
      ...(item.nationality ? { nationality: item.nationality } : {}),
      ...(item.era ? { era: item.era } : {}),
      summary: item.summary,
      palette: item.palette,
      style: item.style ?? { avoid: [] },
      ...(item.thumbnailPath ? { thumbnailPath: item.thumbnailPath } : {}),
      sourcePath: item.sourcePath,
      sourceHash: item.sourceHash,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
  });
  db.saveItems(items);
  return {
    itemIds: items.map((item) => item.id),
    skipped: preview.skipped,
    conflicts: preview.conflicts,
  };
}