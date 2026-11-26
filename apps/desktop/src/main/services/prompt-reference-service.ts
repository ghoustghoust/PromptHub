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

function firstImageIn(directory: string): string | undefined {
  if (!fs.existsSync(directory)) return undefined;
  return fs
    .readdirSync(directory)
    .filter((entry) => IMAGE_EXTENSIONS.has(path.extname(entry).toLowerCase()))
    .sort()
    .map((entry) => path.join(directory, entry))[0];
}

function thumbnailFor(directorDir: string): string | undefined {
  const paletteDir = path.join(directorDir, PALETTE_DIR);
  const preferred = path.join(paletteDir, "palette_main.png");
  if (fs.existsSync(preferred)) return preferred;
  return firstImageIn(paletteDir)
    ?? firstImageIn(path.join(directorDir, "assets", "film_stills"));
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

function scanDirector(
  categoryDir: string,
  directorName: string,
  skipped: PromptReferenceImportSkipped[],
): PromptReferenceItemPreview | null {
  const directorDir = path.join(categoryDir, directorName);
  const palettePath = path.join(directorDir, PALETTE_DIR, "palette.json");
  if (!fs.existsSync(palettePath)) {
    skipped.push({ path: directorDir, reason: "palette.json is missing" });
    return null;
  }
  const paletteRaw = fs.readFileSync(palettePath, "utf8");
  const palette = readJson<PaletteJson>(palettePath);
  if (!palette?.director) {
    skipped.push({ path: directorDir, reason: "palette.json has no director block" });
    return null;
  }
  const manifestPath = path.join(directorDir, MANIFEST_PATH);
  const manifestRaw = fs.existsSync(manifestPath)
    ? fs.readFileSync(manifestPath, "utf8")
    : "";
  const manifest = manifestRaw ? readJson<ManifestJson>(manifestPath) : null;
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
  const thumbnailPath = thumbnailFor(directorDir);
  const directorId = palette.director.id?.trim();
  return {
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
    thumbnailPath,
    sourcePath: directorDir,
    sourceHash: hashText(`${paletteRaw}\n${manifestRaw}`),
    style,
  };
}

/** Scans the color-card library and returns what an import would write. */
export function previewReferenceLibrary(rootPath: string): PromptReferenceImportPreview {
  const root = path.resolve(rootPath);
  if (!fs.statSync(root).isDirectory()) {
    throw new Error(`Reference library root is not a directory: ${root}`);
  }
  const skipped: PromptReferenceImportSkipped[] = [];
  const conflicts: PromptReferenceImportConflict[] = [];
  const items: PromptReferenceItemPreview[] = [];
  const seenDirectorIds = new Map<string, string>();
  for (const categoryName of fs.readdirSync(root).sort()) {
    const categoryDir = path.join(root, categoryName);
    if (!fs.statSync(categoryDir).isDirectory()) continue;
    for (const directorName of fs.readdirSync(categoryDir).sort()) {
      const directorDir = path.join(categoryDir, directorName);
      if (!fs.statSync(directorDir).isDirectory()) continue;
      const item = scanDirector(categoryDir, directorName, skipped);
      if (!item) continue;
      if (!item.directorId) {
        // The card is still importable, but it carries no merge identity.
        conflicts.push({ path: item.sourcePath, reason: "missing-director-id" });
      } else {
        const owner = seenDirectorIds.get(item.directorId);
        if (owner) {
          // Two cards claim one director identity; they are never merged silently.
          skipped.push({
            path: item.sourcePath,
            reason: `duplicate director id ${item.directorId}, already used by ${owner}`,
          });
          continue;
        }
        seenDirectorIds.set(item.directorId, item.sourcePath);
      }
      items.push(item);
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
    const existing = db.findBySourcePath(item.sourcePath);
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