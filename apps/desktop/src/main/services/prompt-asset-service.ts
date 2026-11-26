import fs from "node:fs";
import path from "node:path";
import type { PromptAssetDB } from "@prompthub/db";
import type {
  PromptAssetImportCommitResult,
  PromptAssetImportConflict,
  PromptAssetImportItem,
  PromptAssetImportPreview,
  PromptAssetImportSkipped,
} from "@prompthub/shared/types";

/**
 * The four machine-readable picture libraries of the 014 material package.
 * The `自定义` folder has no index and is therefore never read.
 */
const LIBRARIES = [
  { kind: "costume", dir: "costume", index: "data/costume-zh.json" },
  { kind: "hair", dir: "hair", index: "data/hairstyle-zh.json" },
  { kind: "portrait", dir: "portrait", index: "data/portrait-zh.json" },
  { kind: "pose", dir: "pose", index: "data/pose-zh.json" },
] as const;

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function textList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

/** The picture path of a record, whichever field the library uses. */
function pictureOf(record: Record<string, unknown>): string | null {
  return (
    text(record["原图"]) ??
    text(record.full) ??
    text(record["预览图"]) ??
    text(record.preview)
  );
}

/** The thumbnail path of a record, whichever field the library uses. */
function thumbnailOf(record: Record<string, unknown>): string | null {
  return text(record["缩略图"]) ?? text(record.thumb);
}

/** The thumbnail the renderer shows; the picture stays in the source tree. */
function absoluteThumbnail(root: string, record: Record<string, unknown>): string | null {
  const thumbnail = thumbnailOf(record);
  return thumbnail ? absolutePicture(root, thumbnail) : null;
}

function absolutePicture(root: string, relative: string): string {
  return path.resolve(root, relative.split("/").join(path.sep));
}

function hasImageExtension(relative: string): boolean {
  return IMAGE_EXTENSIONS.has(path.extname(relative).toLowerCase());
}

interface LibraryRecord {
  id: string;
  kind: string;
  path: string;
  title: string;
  meta: Record<string, unknown>;
  /** Portrait the hair record points at, when the library declares one. */
  relation?: string;
}

function costumeRecord(root: string, record: Record<string, unknown>): LibraryRecord | null {
  const sourceId = text(record.id);
  const picture = pictureOf(record);
  if (!sourceId || !picture) return null;
  const keywords = textList(record["关键词"]);
  const english = text(record["英文关键词"]);
  return {
    id: `ghil:costume:${sourceId}`,
    kind: "costume",
    path: absolutePicture(root, picture),
    title: keywords.length > 0 ? keywords.join(" ") : sourceId,
    meta: {
      library: "ghil",
      sourceId,
      category: text(record["分类"]),
      keywords,
      englishKeywords: english,
      thumbnail: absoluteThumbnail(root, record),
      sourceIndex: "costume/data/costume-zh.json",
    },
  };
}

function hairRecord(root: string, record: Record<string, unknown>): LibraryRecord | null {
  const sourceId = text(record.id);
  const picture = pictureOf(record);
  if (!sourceId || !picture) return null;
  return {
    id: `ghil:hair:${sourceId}`,
    kind: "hair",
    path: absolutePicture(root, picture),
    title: text(record.title) ?? text(record["name_zh"]) ?? sourceId,
    meta: {
      library: "ghil",
      sourceId,
      section: text(record.section),
      sectionZh: text(record["section_zh"]),
      hair: text(record.hair),
      hairZh: text(record["hair_zh"]),
      style: text(record.style),
      styleZh: text(record["style_zh"]),
      nameJa: text(record["name_ja"]),
      nameSource: text(record["name_source"]),
      width: typeof record.w === "number" ? record.w : null,
      height: typeof record.h === "number" ? record.h : null,
      thumbnail: absoluteThumbnail(root, record),
      sourceIndex: "hair/data/hairstyle-zh.json",
    },
    relation: text(record.source_id),
  };
}

function portraitRecord(root: string, record: Record<string, unknown>): LibraryRecord | null {
  const sourceId = text(record.id);
  const picture = pictureOf(record);
  if (!sourceId || !picture) return null;
  return {
    id: `ghil:portrait:${sourceId}`,
    kind: "portrait",
    path: absolutePicture(root, picture),
    title: text(record.title) ?? sourceId,
    meta: {
      library: "ghil",
      sourceId,
      section: text(record.section),
      sectionZh: text(record["section_zh"]),
      hair: text(record.hair),
      hairZh: text(record["hair_zh"]),
      style: text(record.style),
      styleZh: text(record["style_zh"]),
      width: typeof record.w === "number" ? record.w : null,
      height: typeof record.h === "number" ? record.h : null,
      thumbnail: absoluteThumbnail(root, record),
      sourceIndex: "portrait/data/portrait-zh.json",
    },
  };
}

function poseRecord(root: string, record: Record<string, unknown>): LibraryRecord | null {
  const sourceId = text(record.id);
  const picture = pictureOf(record);
  const group = text(record["体系"]);
  const poseNumber = text(record["姿势编号"]);
  const angle = text(record["角度"]);
  if (!sourceId || !picture || !group || !poseNumber || !angle) return null;
  return {
    id: `ghil:pose:${group}:${poseNumber}:${angle}`,
    kind: "pose",
    path: absolutePicture(root, picture),
    title: text(record["姿势名称"]) ?? `${poseNumber} ${angle}`,
    meta: {
      library: "ghil",
      sourceId,
      group,
      poseNumber,
      angle,
      category: text(record["分类"]),
      poseName: text(record["姿势名称"]),
      thumbnail: absoluteThumbnail(root, record),
      sourceIndex: "pose/data/pose-zh.json",
    },
  };
}

const RECORD_BUILDERS = {
  costume: costumeRecord,
  hair: hairRecord,
  portrait: portraitRecord,
  pose: poseRecord,
} as const;

/**
 * Reads the four index files of a picture library. The preview lists what an
 * import would write, which records are skipped and which relations could not
 * be resolved. Nothing in the package is executed.
 */
export function previewAssetLibrary(rootPath: string): PromptAssetImportPreview {
  const root = path.resolve(rootPath);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`Asset library root is not a directory: ${root}`);
  }
  const items: PromptAssetImportItem[] = [];
  const skipped: PromptAssetImportSkipped[] = [];
  const conflicts: PromptAssetImportConflict[] = [];
  const counts: Record<string, number> = {};
  const seenIds = new Set<string>();
  const portraitIds = new Set<string>();
  const hairRelations: Array<{ id: string; relation: string }> = [];

  for (const library of LIBRARIES) {
    const libraryRoot = path.join(root, library.dir);
    const indexPath = path.join(libraryRoot, library.index);
    if (!fs.existsSync(indexPath)) {
      skipped.push({
        id: path.relative(root, indexPath).split(path.sep).join("/"),
        reason: "library index file is missing",
      });
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    } catch (cause) {
      throw new Error(
        `Asset library index is not valid JSON: ${indexPath} (${cause instanceof Error ? cause.message : String(cause)})`,
      );
    }
    if (!Array.isArray(parsed)) {
      skipped.push({
        id: path.relative(root, indexPath).split(path.sep).join("/"),
        reason: "library index file is not an array",
      });
      continue;
    }
    let count = 0;
    for (const entry of parsed) {
      if (!isRecord(entry)) {
        skipped.push({ id: library.kind, reason: "record is not an object" });
        continue;
      }
      const record = RECORD_BUILDERS[library.kind](libraryRoot, entry);
      if (!record) {
        skipped.push({
          id: text(entry.id) ?? library.kind,
          reason: "record is missing an id, a group or a picture",
        });
        continue;
      }
      if (!hasImageExtension(record.path)) {
        skipped.push({ id: record.id, reason: "picture path is not an image" });
        continue;
      }
      if (!fs.existsSync(record.path)) {
        skipped.push({ id: record.id, reason: `picture file is missing: ${record.path}` });
        continue;
      }
      if (seenIds.has(record.id)) {
        conflicts.push({
          id: record.id,
          kind: record.kind,
          reason: "duplicate-id",
          detail: "the same id appears twice in the library",
        });
        skipped.push({ id: record.id, reason: "duplicate id" });
        continue;
      }
      seenIds.add(record.id);
      if (record.kind === "portrait") {
        portraitIds.add(String(record.meta.sourceId ?? ""));
      }
      if (record.relation) {
        hairRelations.push({ id: record.id, relation: record.relation });
      }
      items.push({
        id: record.id,
        kind: record.kind,
        path: record.path,
        title: record.title,
        meta: record.meta,
      });
      count += 1;
    }
    counts[library.kind] = count;
  }

  for (const relation of hairRelations) {
    if (!portraitIds.has(relation.relation)) {
      conflicts.push({
        id: relation.id,
        kind: "hair",
        reason: "missing-source-relation",
        detail: `portrait ${relation.relation} is not in the library`,
      });
    }
  }

  return { items, skipped, conflicts, counts };
}

/** Writes the previewed assets; the pictures stay in the read-only source tree. */
export function commitAssetImport(
  db: PromptAssetDB,
  preview: PromptAssetImportPreview,
): PromptAssetImportCommitResult {
  const now = Date.now();
  const result = db.saveAssets(
    preview.items.map((item) => ({
      id: item.id,
      kind: item.kind,
      path: item.path,
      title: item.title,
      meta: item.meta,
      createdAt: now,
    })),
  );
  return {
    assetIds: preview.items.map((item) => item.id),
    inserted: result.inserted,
    updated: result.updated,
    skipped: preview.skipped,
    conflicts: preview.conflicts,
  };
}
