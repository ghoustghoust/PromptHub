import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseAdapter, migratePromptVocabSchema } from "@prompthub/db";

/**
 * Imports the bundled reference vocabularies into prompt_terms.
 * Usage: tsx scripts/import-vocabulary.ts <db-path>
 * Idempotent: re-running fills missing terms and repairs legacy SkyLoong category assignments in place.
 */

type Domain = "shared" | "anime" | "real" | "3d";

/** Resolve from the script location so `pnpm --filter … exec tsx` cannot change it. */
const ROOT = path.resolve(path.dirname(process.argv[1]), "..");
const TAGLIB = path.join(
  ROOT,
  "prompt",
  "SkyLoongAI绘画工具集-精简版v2.1",
  "SkyLoongAI绘画工具集-精简版",
  "taglib.json",
);
const TAGCARS = path.join(path.dirname(TAGLIB), "tagcats.json");
const GENERATOR_DIR = path.join(ROOT, "prompt", "提示词生成器v3.0", "提示词生成器v3.0");
const WORKBENCH_DIR = path.join(ROOT, "prompt", "prompt-workbench-main", "prompt-workbench-main");
const ATLAS_PROMPTS = path.join(
  ROOT,
  "prompt",
  "corpus",
  "portrait-prompt-atlas",
  "data",
  "prompts.jsonl",
);
const SHUIXIAN_DIR = path.join(
  ROOT,
  "prompt",
  "corpus",
  "shuixian-prompts",
  "shuixian-unified",
  "data",
);
const CYS_REFERENCES = path.join(ROOT, "prompt", "corpus", "cys-portrait-prompts", "references");
const MAGAZINE_PROMPTS = path.join(
  ROOT,
  "prompt",
  "corpus",
  "ai-magazine-photographer",
  "references",
  "prompts.md",
);
const HF_PROMPTS = path.join(
  ROOT,
  "prompt",
  "corpus",
  "hf-photoreal-prompts",
  "prompts.jsonl",
);
const NUYOAH_LOGIC = path.join(
  ROOT,
  "prompt",
  "corpus",
  "nuyoah-xiezhen-prompt",
  "references",
  "prompt-logic.md",
);
const AWESOME_README = path.join(
  ROOT,
  "prompt",
  "corpus",
  "Awesome-AI-Image-Prompts",
  "README.md",
);

interface Term {
  id: string;
  /** Old category-derived id used to repair existing SkyLoong rows without changing their identity. */
  legacyId?: string;
  category: string;
  subcategory: string | null;
  en: string;
  zh: string | null;
  source: string;
  domain: Domain;
}

/**
 * Terms that only make sense inside one rendering world. Everything else stays
 * `shared`, because hair, pose, clothing and backgrounds cross over freely.
 */
const ANIME_HINTS = [
  "anime", "manga", "comic", "cel shading", "celluloid", "chibi", "ghibli",
  "kyoani", "kyoto animation", "4koma", "webtoon", "doujinshi", "light novel",
  "visual novel", "screentone", "ukiyo", "illustration", "game cg", "visual novel",
];
const REAL_HINTS = [
  "photorealistic", "photo", "photography", "dslr", "realistic", "reality",
  "polaroid", "analog photo", "smartphone photo", "film grain", "real life",
];
const THREE_D_HINTS = [
  "3d", "cgi", "octane", "blender", "unreal engine", "ray tracing",
  "global illumination", "ambient occlusion", "low poly", "subsurface scattering",
];

function inferDomain(category: string, en: string): Domain {
  if (category === "character" || category === "artist" || category === "work") {
    return "anime";
  }
  const value = en.toLowerCase();
  if (THREE_D_HINTS.some((hint) => value.includes(hint))) return "3d";
  if (REAL_HINTS.some((hint) => value.includes(hint))) return "real";
  if (ANIME_HINTS.some((hint) => value.includes(hint))) return "anime";
  return "shared";
}

/** Chinese category/sub-category names mapped onto PromptHub's machine categories. */
const CATEGORY_MAP: Record<string, string> = {
  人物: "character",
  角色: "character",
  服饰: "clothing",
  汉服: "clothing",
  表情动作: "pose",
  环境: "environment",
  场景: "environment",
  物品: "props",
  镜头: "camera",
  魔法系: "effect",
  反向提示词: "negative",
  作品: "work",
  画师: "artist",
  画风: "style",
  画面: "composition",
};

/** Sub-categories that read better under a more specific machine category. */
const SUBCATEGORY_MAP: Record<string, string> = {
  光照: "lighting",
  背景: "environment",
  艺术风格: "style",
  艺术类型: "style",
  艺术派系: "style",
  艺术家风格: "artist",
  "Anima 官方标签": "style",
  画质: "style",
  写实: "style",
  素描: "style",
  画笔: "style",
};

/**
 * Parent-aware assignments prevent broad source groups such as 人物 and 表情动作
 * from leaking anatomy, hair and expressions into character or pose.
 */
const PARENT_SUBCATEGORY_MAP: Record<string, Record<string, string>> = {
  人物: {
    皮肤: "body",
    身材: "body",
    指甲: "body",
    肩部: "body",
    胸部: "body",
    腰部: "body",
    腹部: "body",
    翅膀: "body",
    脸型: "face",
    面部: "face",
    耳朵: "face",
    眉毛: "face",
    眼睛: "face",
    瞳孔: "face",
    鼻子: "face",
    牙齿: "face",
    头发: "hair",
    嘴巴: "expression",
    舌头: "expression",
  },
  表情动作: {
    笑: "expression",
    哭: "expression",
    不开心: "expression",
    蔑视: "expression",
    生气: "expression",
    其他表情: "expression",
  },
  服饰: {
    与裙子互动: "pose",
    与裤子互动: "pose",
    与袜子互动: "pose",
    围巾: "accessory",
    眼镜: "accessory",
    面具: "accessory",
    手套: "accessory",
    耳饰: "accessory",
    头饰: "accessory",
    帽子: "accessory",
    发饰: "accessory",
    小装饰: "accessory",
    首饰: "accessory",
  },
  环境: {
    季节: "weather",
    天气: "weather",
  },
  镜头: {
    其他构图: "composition",
    主角动作: "pose",
  },
  画面: {
    颜色: "style",
  },
};

/** Generator category ids already match our machine categories. */
const GENERATOR_CATEGORY: Record<string, string> = {
  style: "style",
  artist: "artist",
  composition: "composition",
  camera: "camera",
  lighting: "lighting",
};

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function fromTaglib(): Term[] {
  const data = readJson<{
    categories?: Array<{ name?: string; subs?: Array<{ name?: string; tags?: string[][] }> }>;
  }>(TAGLIB);
  const terms: Term[] = [];
  for (const category of data.categories ?? []) {
    const name = (category.name ?? "").trim();
    if (!name) continue;
    const categoryKey = CATEGORY_MAP[name] ?? "other";
    for (const sub of category.subs ?? []) {
      const subName = (sub.name ?? "").trim();
      const legacySubKey = SUBCATEGORY_MAP[subName] ?? categoryKey;
      const subKey = PARENT_SUBCATEGORY_MAP[name]?.[subName] ?? legacySubKey;
      for (const pair of sub.tags ?? []) {
        const zh = (pair?.[0] ?? "").trim();
        const en = (pair?.[1] ?? "").trim();
        if (!en) continue;
        terms.push({
          id: `sky:${subKey}:${subName}:${en}`.slice(0, 128),
          ...(subKey !== legacySubKey
            ? { legacyId: `sky:${legacySubKey}:${subName}:${en}`.slice(0, 128) }
            : {}),
          category: subKey,
          subcategory: subName || null,
          en,
          zh: zh || null,
          source: "skyloong-taglib",
          domain: inferDomain(subKey, en),
        });
      }
    }
  }
  return terms;
}

function fromTagcats(): Term[] {
  const data = readJson<{ artist?: string[]; meta?: string[] }>(TAGCARS);
  const terms: Term[] = [];
  for (const en of data.artist ?? []) {
    const name = en.trim();
    if (!name) continue;
    terms.push({
      id: `danbooru-artist:${name}`.slice(0, 128),
      category: "artist",
      subcategory: "danbooru",
      en: name,
      zh: null,
      source: "danbooru-artists",
      domain: "anime",
    });
  }
  for (const en of data.meta ?? []) {
    const name = en.trim();
    if (!name) continue;
    terms.push({
      id: `danbooru-meta:${name}`.slice(0, 128),
      category: "meta",
      subcategory: "danbooru",
      en: name,
      zh: null,
      source: "danbooru-meta",
      domain: "shared",
    });
  }
  return terms;
}

interface GeneratorWindow {
  PG_TAGS?: Array<{ id?: string; name?: string; tags?: string }>;
  PG_CHARACTERS?: Array<{ name?: string; tag?: string; charZh?: string; game?: string }>;
}

function fromGenerator(): Term[] {
  const htmlFile = fs
    .readdirSync(GENERATOR_DIR)
    .find((entry) => entry.toLowerCase().endsWith(".html"));
  if (!htmlFile) return [];
  const source = fs.readFileSync(path.join(GENERATOR_DIR, htmlFile), "utf8");
  const scope: GeneratorWindow = {};
  for (const name of ["PG_TAGS", "PG_CHARACTERS"] as const) {
    const start = source.indexOf(`window.${name} =`);
    if (start < 0) continue;
    const end = source.indexOf("</script>", start);
    if (end < 0) continue;
    // The bundled blocks are pure data literals; evaluate them against a fake window.
    new Function("window", source.slice(start, end))(scope);
  }

  const terms: Term[] = [];
  for (const category of scope.PG_TAGS ?? []) {
    const categoryKey = GENERATOR_CATEGORY[category.id ?? ""] ?? "style";
    const catName = (category.name ?? "").trim();
    for (const line of String(category.tags ?? "").split("\n")) {
      const text = line.trim();
      if (!text) continue;
      const split = text.indexOf("|");
      const en = (split < 0 ? text : text.slice(0, split)).trim();
      const zh = split < 0 ? "" : text.slice(split + 1).trim();
      if (!en) continue;
      terms.push({
        id: `gen:${categoryKey}:${catName}:${en}`.slice(0, 128),
        category: categoryKey,
        subcategory: catName || null,
        en,
        zh: zh || null,
        source: "prompt-generator-v3",
        domain: inferDomain(categoryKey, en),
      });
    }
  }
  for (const character of scope.PG_CHARACTERS ?? []) {
    const en = (character.tag ?? "").trim();
    if (!en) continue;
    terms.push({
      id: `gen:character:${en}`.slice(0, 128),
      category: "character",
      subcategory: (character.game ?? "").trim() || null,
      en,
      zh: (character.charZh ?? character.name ?? "").trim() || null,
      source: "prompt-generator-v3",
      domain: "anime",
    });
  }
  return terms;
}

interface WorkbenchTag {
  zh?: string;
  en: string;
  cat?: string;
  sub?: string;
  nsfw?: boolean;
}

interface WorkbenchStyle {
  tag: string;
  zh: string;
  desc?: string;
}

/** Prompt Workbench categories mapped onto machine fields, using its own sub-navigation. */
const WORKBENCH_CATEGORY: Record<string, string> = {
  角色: "character",
  服装: "clothing",
  动作: "pose",
  道具: "props",
  场景: "environment",
  自定义: "style",
  外形: "body",
};

const WORKBENCH_SUBCATEGORY: Record<string, Record<string, string>> = {
  外形: {
    发色: "hair",
    发型: "hair",
    眼睛: "face",
    表情: "expression",
    体型: "body",
    身体: "body",
  },
  场景: {
    光线: "lighting",
    天气: "weather",
    时间段: "weather",
    室内: "environment",
    室外: "environment",
    建筑: "environment",
  },
  自定义: {
    效果: "effect",
    构图: "composition",
    画质: "style",
    类型: "style",
    色彩: "style",
    视角: "camera",
    镜头: "camera",
    风格: "style",
    图反推: "character",
  },
};

function fromWorkbench(): Term[] {
  const tagsFile = path.join(WORKBENCH_DIR, "tags_cn.json");
  const stylesFile = path.join(WORKBENCH_DIR, "styles.json");
  const terms: Term[] = [];
  if (fs.existsSync(tagsFile)) {
    const data = readJson<{ tags?: WorkbenchTag[] }>(tagsFile);
    const adult = new Set(
      (data.tags ?? [])
        .filter((tag) => tag.nsfw && (tag.en ?? "").trim())
        .map((tag) => (tag.en ?? "").trim().toLowerCase()),
    );
    for (const tag of data.tags ?? []) {
      const en = (tag.en ?? "").trim();
      if (!en) continue;
      // One explicit term should not also sit in a safe field.
      if (!tag.nsfw && adult.has(en.toLowerCase())) continue;
      const sourceCat = (tag.cat ?? "").trim();
      const mapped = WORKBENCH_CATEGORY[sourceCat] ?? "style";
      const subcategory = WORKBENCH_SUBCATEGORY[sourceCat]?.[(tag.sub ?? "").trim()] ?? mapped;
      // Explicit adult tags live in their own category; the source field stays
      // visible as the sub-navigation so they remain findable by intent.
      const category = tag.nsfw ? "nsfw" : subcategory;
      const navigation = tag.nsfw ? sourceCat || "nsfw" : (tag.sub ?? "").trim() || null;
      terms.push({
        id: `wb:${category}:${en}`.slice(0, 128),
        category,
        subcategory: navigation,
        en,
        zh: (tag.zh ?? "").trim() || null,
        source: "prompt-workbench",
        domain: inferDomain(subcategory, en),
      });
    }
  }
  if (fs.existsSync(stylesFile)) {
    const styles = readJson<WorkbenchStyle[]>(stylesFile);
    for (const style of styles) {
      const en = (style.tag ?? "").trim();
      if (!en) continue;
      terms.push({
        id: `wb:style:${en}`.slice(0, 128),
        category: "style",
        subcategory: "工作台画风",
        en,
        zh: (style.zh ?? "").trim() || null,
        source: "prompt-workbench",
        domain: inferDomain("style", en),
      });
    }
  }
  return terms;
}

/** Slot names in portrait-prompt-atlas that map onto reusable fields. */
const ATLAS_SLOTS: Record<string, string> = {
  pose: "pose", "pose description": "pose", "pose style": "pose", "new pose": "pose",
  action: "pose", activity: "pose", "pose and expression": "pose",
  expression: "expression", "facial expression": "expression",
  hair: "hair", hairstyle: "hair", "hair style": "hair", "hair color": "hair", "hair type": "hair",
  "eye color": "face",
  outfit: "clothing", clothing: "clothing", "clothing style": "clothing", "clothing item": "clothing",
  "clothing theme": "clothing", "clothing and accessories": "clothing", "clothing fabric": "clothing",
  top: "clothing", "top style": "clothing", "top layer": "clothing", "top clothing": "clothing",
  "top garment": "clothing", shirt: "clothing", "shirt color": "clothing", blouse: "clothing",
  dress: "clothing", "dress style": "clothing", "dress color": "clothing", "dress colors": "clothing",
  pants: "clothing", "pants style": "clothing", bottoms: "clothing", bottom: "clothing",
  "skirt style": "clothing", "skirt length": "clothing", jacket: "clothing", "jacket style": "clothing",
  outerwear: "clothing", footwear: "clothing", attire: "clothing", costume: "clothing",
  wardrobe: "clothing", jersey: "clothing", "jersey style": "clothing", "team jersey": "clothing",
  "national kit": "clothing", suit: "clothing", "suit color": "clothing", "suit tone": "clothing",
  "top outfit color": "clothing", "bottom outfit color": "clothing", "outfit top": "clothing",
  "outfit bottom": "clothing", "outfit color": "clothing", "outfit colors": "clothing",
  "outfit style": "clothing", "male outfit": "clothing", "female outfit": "clothing",
  "man attire": "clothing", "woman attire": "clothing", "outfit one": "clothing",
  "outfit two": "clothing", "outfit three": "clothing",
  accessory: "accessory", accessories: "accessory", earrings: "accessory", jewelry: "accessory",
  eyewear: "accessory", sunglasses: "accessory", glasses: "accessory", "glasses style": "accessory",
  headwear: "accessory", "mask type": "accessory",
  background: "environment", "background color": "environment", "background colors": "environment",
  "background details": "environment", "background location": "environment",
  "background pattern": "environment", "background gradient": "environment",
  "background style": "environment", "backdrop color": "environment", setting: "environment",
  location: "environment", environment: "environment", "interior style": "environment",
  "room setting": "environment", "room type": "environment", "studio background": "environment",
  "wall texture": "environment", scene: "environment", "location vibe": "environment",
  "forest setting": "environment", city: "environment", region: "environment",
  landmark: "environment", structure: "environment", "architecture style": "environment",
  "desk type": "environment",
  lighting: "lighting", "lighting style": "lighting", "lighting color": "lighting",
  "lighting effect": "lighting", "rim light color": "lighting", "primary rim light": "lighting",
  "secondary rim light": "lighting", "time of day": "lighting", time: "lighting",
  camera: "camera", "camera model": "camera", "camera angle": "camera", "camera lens": "camera",
  lens: "camera", "lens type": "camera", "lens color": "camera", "aspect ratio": "camera",
  composition: "camera",
  style: "style", "art style": "style", "artistic style": "style", "visual style": "style",
  "photo style": "style", "film style": "style", "main style": "style", "shading style": "style",
  "animation style": "style", "finish style": "style", "fashion style": "style",
  aesthetic: "style", "aesthetic style": "style", "aesthetic period": "style",
  "art medium": "style", "color palette": "style", "color scheme": "style", colors: "style",
  color: "style", "color theme": "style", "color tones": "style", tones: "style",
  "accent color": "style", "makeup style": "style", makeup: "style", "regional style": "style",
  "clothing style 2": "style",
  mood: "effect", atmosphere: "effect", vibe: "effect", vibes: "effect",
  "overall mood": "effect", "visual energy": "effect",
  prop: "props", props: "props", object: "props", objects: "props", furniture: "props",
  "furniture color": "props", vehicle: "props", car: "props", animal: "props",
  animals: "props", pet: "props", birds: "props", flowers: "props", "flower type": "props",
  product: "props", "held object": "props", "magical item": "props", weapon: "props",
  trophy: "props", "candy bar": "props", drink: "props", beverage: "props", snack: "props",
};

const PLACEHOLDER_VALUES = /^\[.*\]$|^\.\.\.$|^your |^the uploaded|^uploaded|^the provided|^reference image|^person_name|^\[|^selected /i;
/** Aspect ratios and "use X from the photo" instructions are not reusable tags. */
const ATLAS_NOISE = /^\d+:\d+|^clothes from|from the (photo|image|reference)|^\d+(\.\d+)? ?mp$|instruction|consists of/i;
const GENERIC_COLORS = new Set([
  "red", "blue", "green", "black", "white", "yellow", "purple", "pink",
  "orange", "grey", "gray", "brown", "beige", "teal", "navy", "gold", "silver",
]);

function atlasId(category: string, value: string): string {
  const digest = crypto.createHash("sha1").update(value).digest("hex").slice(0, 12);
  return `atlas:${category}:${digest}`;
}

/**
 * The portrait atlas is a real-person prompt corpus. Only the `{argument}`
 * slot defaults are stable, reusable phrases; prose sentences are not split
 * into fake tags. Slots that describe shared appearance stay `shared`, while
 * style and camera gear remain real-photography specific.
 */
function fromPortraitAtlas(): Term[] {
  if (!fs.existsSync(ATLAS_PROMPTS)) return [];
  const slot = /\{argument\s+name="([^"]+)"\s+default="([^"]*)"\}/g;
  const terms: Term[] = [];
  const seen = new Set<string>();
  for (const line of fs.readFileSync(ATLAS_PROMPTS, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    let promptText: string;
    try {
      promptText = String((JSON.parse(line) as { prompt_text?: string }).prompt_text ?? "");
    } catch {
      continue;
    }
    let match: RegExpExecArray | null;
    while ((match = slot.exec(promptText))) {
      const category = ATLAS_SLOTS[match[1].trim().toLowerCase()];
      if (!category) continue;
      const value = match[2].replace(/\s+/g, " ").trim().replace(/[.;]+$/, "");
      if (value.length < 2 || value.length > 140) continue;
      if (PLACEHOLDER_VALUES.test(value)) continue;
      if (ATLAS_NOISE.test(value)) continue;
      if (GENERIC_COLORS.has(value.toLowerCase().replace(/\s+(colou?r)$/, ""))) continue;
      if (/[{}]/.test(value)) continue;
      const key = `${category}\u0000${value.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      terms.push({
        id: atlasId(category, value),
        category,
        subcategory: "真人语料",
        en: value,
        zh: null,
        source: "portrait-prompt-atlas",
        domain: category === "style" || category === "camera" ? "real" : "shared",
      });
    }
  }
  return terms;
}

const SHUIXIAN_LABELS: Record<string, string> = {
  风格: "style", 视觉风格: "style", 画风: "style", 艺术风格: "style",
  服装: "clothing", 穿搭: "clothing", 服饰: "clothing",
  表情: "expression", 姿势: "pose", 动作: "pose",
  背景: "environment", 场景: "environment", 环境: "environment",
  光影: "lighting", 光线: "lighting", 光照: "lighting",
  构图: "composition", 视角: "camera", 镜头: "camera",
  发型: "hair", 发色: "hair", 头发: "hair",
  妆容: "face", 面部: "face", 道具: "props",
};

const SHUIXIAN_SLOTS: Record<string, string> = {
  "hair color": "hair", "hair style": "hair", hairstyle: "hair", hair: "hair",
  outfit: "clothing", clothing: "clothing", "outfit style": "clothing", attire: "clothing",
  style: "style", "art style": "style", "visual style": "style", "color palette": "style",
  expression: "expression", "facial expression": "expression",
  pose: "pose", action: "pose", activity: "pose",
  background: "environment", "background color": "environment", setting: "environment",
  location: "environment", scene: "environment", environment: "environment",
  lighting: "lighting", "lighting style": "lighting", "time of day": "lighting",
  composition: "composition", camera: "camera", "camera angle": "camera", lens: "camera",
  prop: "props", props: "props", object: "props",
  "character name": "character", character: "character", "character description": "character",
  subject: "character", "subject description": "character", "character type": "character",
};

/** Source categories that are already anime, so their style/character terms stay anime. */
const SHUIXIAN_ANIME_CATEGORIES = new Set([
  "动漫or二次元", "可爱动漫", "角色板or三视图", "日漫艺术创作", "其他动漫", "动漫",
  "二次元大凶美女", "二次元动漫美女", "真人日漫", "复古动漫", "漫画", "原神", "游戏",
  "英雄联盟", "高达", "动漫个人海报", "动漫插画",
]);

/** Fields the user treats as cross-subject; their terms stay available everywhere. */
const SHUIXIAN_SHARED = new Set([
  "hair", "pose", "expression", "clothing", "environment", "lighting", "camera",
  "composition", "props", "face",
]);

const GENERIC_COLORS_ALL = new Set([
  "白", "黑", "红", "蓝", "绿", "黄", "紫", "粉", "橙", "灰", "棕", "金", "银",
  "red", "blue", "green", "black", "white", "yellow", "purple", "pink", "orange",
  "grey", "gray", "brown", "beige", "teal", "navy", "gold", "silver",
]);

const PLACEHOLDER_TOKENS = new Set([
  "clothing", "background", "location name", "subject", "name", "text", "style",
  "outfit", "character", "object", "description", "color", "…", "...",
]);

function shuixianPlaceholder(value: string): boolean {
  const lower = value.toLowerCase().trim();
  if (PLACEHOLDER_TOKENS.has(lower)) return true;
  if (/^\(.+\)$/.test(value) || /^（.+）$/.test(value)) return true;
  if (/^#[0-9a-f]{3,8}$/i.test(value)) return true;
  if (/^[【\[（("'“]/.test(value)) return true;
  if (/^[—\-–·.,，。]/.test(value)) return true;
  if (value.includes("..")) return true;
  return false;
}

function shuixianValues(raw: string): string[] {
  const parts = raw.split(/\s*[/／]\s*/).filter((part) => part.trim());
  const output: string[] = [];
  for (const part of parts.length > 1 ? parts : [raw]) {
    const value = part
      .replace(/\s+/g, " ")
      .replace(/[。；;，,、]+$/g, "")
      .replace(/^[“”"'《》\s]+|[“”"'《》\s]+$/g, "")
      .trim();
    if (value.length < 3 || value.length > 60) continue;
    if (/[{}<>[\]：；。]/.test(value)) continue;
    if (/^(使用|保持|不要|必须|禁止|参考|确保|避免|根据|以|如果|请|可以|需要|她的|他的|我的|你的)/.test(value)) continue;
    if (value.includes("上传")) continue;
    if (/^[\d\s.:%×x-]+$/i.test(value)) continue;
    if (/^\d+\s*:\s*\d+/.test(value)) continue;
    if (shuixianPlaceholder(value)) continue;
    const colorKey = value.toLowerCase().replace(/\s*(colou?r)$/, "").replace(/色$/, "");
    if (GENERIC_COLORS_ALL.has(colorKey)) continue;
    output.push(value);
  }
  return output;
}

/**
 * Chinese photoreal prompt corpus. Only labelled sections and slot defaults are
 * considered; unique long prose is dropped, while repeated or short unique
 * descriptors survive. Shared appearance fields stay `shared`; style and
 * character phrases follow the source category's subject domain.
 */
function fromShuixian(): Term[] {
  if (!fs.existsSync(SHUIXIAN_DIR)) return [];
  const rows: Array<{ category?: string; prompt?: string }> = [];
  for (const file of ["prompts.part1.json", "prompts.part2.json", "prompts.part3.json"]) {
    const filePath = path.join(SHUIXIAN_DIR, file);
    if (!fs.existsSync(filePath)) continue;
    rows.push(...readJson<Array<{ category?: string; prompt?: string }>>(filePath));
  }
  const sectionRe = /(?:^|[；;\n])\s*([\u4e00-\u9fa5A-Za-z ]{2,8})：([^；;\n]{4,90})/g;
  const slotRe = /\{argument\s+name="([^"]+)"\s+default="([^"]*)"\}/g;
  const counted = new Map<string, { category: string; domain: Domain; text: string; n: number }>();

  const add = (category: string, promptDomain: Domain, raw: string) => {
    const domain = SHUIXIAN_SHARED.has(category) ? "shared" : promptDomain;
    for (const text of shuixianValues(raw)) {
      const key = `${category}\u0000${domain}\u0000${text.toLowerCase()}`;
      const entry = counted.get(key);
      if (entry) entry.n += 1;
      else counted.set(key, { category, domain, text, n: 1 });
    }
  };

  for (const row of rows) {
    const text = String(row.prompt ?? "");
    const source = String(row.category ?? "");
    const promptDomain: Domain =
      source === "3D" ? "3d" : SHUIXIAN_ANIME_CATEGORIES.has(source) ? "anime" : "real";
    let match: RegExpExecArray | null;
    sectionRe.lastIndex = 0;
    while ((match = sectionRe.exec(text))) {
      const category = SHUIXIAN_LABELS[match[1].trim()];
      if (category) add(category, promptDomain, match[2]);
    }
    slotRe.lastIndex = 0;
    while ((match = slotRe.exec(text))) {
      const category = SHUIXIAN_SLOTS[match[1].trim().toLowerCase()];
      if (category) add(category, promptDomain, match[2]);
    }
  }

  const terms: Term[] = [];
  for (const { category, domain, text, n } of counted.values()) {
    const shortUnique = n === 1 && text.length <= 16 && !/[，、]/.test(text);
    if (n < 2 && !shortUnique) continue;
    const digest = crypto.createHash("sha1").update(`${domain}\u0000${text}`).digest("hex").slice(0, 10);
    terms.push({
      id: `sx:${category}:${domain}:${digest}`,
      category,
      subcategory: "中文写真",
      en: text,
      zh: null,
      source: "shuixian-prompts",
      domain,
    });
  }
  return terms;
}

/** cys taxonomy groups mapped onto machine fields. */
function cysGroup(key: string): { category: string; subcategory: string; domain: Domain } | null {
  if (key.startsWith("服装_") || key.startsWith("汉服_") || key.startsWith("鞋履_")) {
    return { category: "clothing", subcategory: key, domain: "shared" };
  }
  if (key.startsWith("饰品_")) return { category: "accessory", subcategory: "饰品", domain: "shared" };
  if (key === "面料") return { category: "clothing", subcategory: "面料", domain: "shared" };
  if (key === "背景") return { category: "environment", subcategory: "背景", domain: "shared" };
  if (key.startsWith("色彩_")) return { category: "style", subcategory: "色彩", domain: "shared" };
  if (key === "风格") return { category: "style", subcategory: "真人风格", domain: "real" };
  if (key === "抖音热搜穿搭标签") {
    return { category: "style", subcategory: "真人风格", domain: "real" };
  }
  return null;
}

/**
 * Structured real-person wardrobe taxonomy (2.5k terms). Clothing, accessories
 * and backgrounds stay `shared`; real-fashion style labels are `real`.
 */
function fromCysVocabulary(): Term[] {
  if (!fs.existsSync(CYS_REFERENCES)) return [];
  const file = fs.readdirSync(CYS_REFERENCES).find((name) => name.endsWith(".json"));
  if (!file) return [];
  const data = readJson<Record<string, unknown>>(path.join(CYS_REFERENCES, file));
  const terms: Term[] = [];
  const seen = new Set<string>();
  for (const [key, value] of Object.entries(data)) {
    if (!Array.isArray(value)) continue;
    const group = cysGroup(key);
    if (!group) continue;
    for (const raw of value) {
      const text = String(raw ?? "").trim();
      if (text.length < 1 || text.length > 60) continue;
      if (/[{}<>]/.test(text)) continue;
      const dedupe = `${group.category}\u0000${text.toLowerCase()}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      const digest = crypto.createHash("sha1").update(text).digest("hex").slice(0, 10);
      terms.push({
        id: `cys:${group.category}:${digest}`,
        category: group.category,
        subcategory: group.subcategory,
        en: text,
        zh: null,
        source: "cys-portrait-prompts",
        domain: group.domain,
      });
    }
  }
  return terms;
}

/** 30 magazine-photography scenes with explicit 场景/姿势/手部/表情/氛围 breakdowns. */
function fromMagazineScenes(): Term[] {
  if (!fs.existsSync(MAGAZINE_PROMPTS)) return [];
  const fieldMap: Record<string, string> = {
    场景: "environment",
    姿势: "pose",
    手部: "pose",
    表情: "expression",
    氛围: "effect",
  };
  const terms: Term[] = [];
  const seen = new Set<string>();
  for (const line of fs.readFileSync(MAGAZINE_PROMPTS, "utf8").split(/\r?\n/)) {
    const match = /^-\s*([^：:]{2,4})[：:]\s*(.+)$/.exec(line.trim());
    if (!match) continue;
    const category = fieldMap[match[1]];
    if (!category) continue;
    const text = match[2].trim().replace(/[。；;，,、]+$/g, "");
    if (text.length < 2 || text.length > 30) continue;
    if (/未特殊说明|无$/.test(text)) continue;
    const dedupe = `${category}\u0000${text.toLowerCase()}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    const digest = crypto.createHash("sha1").update(text).digest("hex").slice(0, 10);
    terms.push({
      id: `mag:${category}:${digest}`,
      category,
      subcategory: "杂志场景",
      en: text,
      zh: null,
      source: "ai-magazine-photographer",
      domain: "shared",
    });
  }
  return terms;
}

/** Keyword → field for HF photoreal clauses; camera gear stays real-specific. */
const HF_LEXICON: Array<{ category: string; words: RegExp }> = [
  { category: "hair", words: /\b(hair|braid|ponytail|bangs|bob|curls|updo|bun|pixie)\b/i },
  { category: "face", words: /\b(eyes|eyebrows|lashes|lips|skin|cheekbones|jawline|beard|freckles|complexion|face)\b/i },
  { category: "clothing", words: /\b(wearing|dress|shirt|blouse|jacket|coat|suit|skirt|pants|trousers|sweater|hoodie|jewelry|earrings|necklace|hat|scarf|glasses)\b/i },
  { category: "lighting", words: /\b(light|lighting|sunlight|sunset|sunrise|shadow|shadows|backlit|glow|illuminated|golden hour|dusk)\b/i },
  { category: "camera", words: /\b(camera|lens|mm|angle|framing|focus|bokeh|dslr|iphone|shot|perspective|close-up|portrait)\b/i },
  { category: "environment", words: /\b(background|backdrop|setting|beach|street|room|studio|city|forest|park|interior|outdoor|landscape|wall)\b/i },
  { category: "pose", words: /\b(pose|posing|standing|sitting|seated|leaning|walking|kneeling|arms|hands|posture)\b/i },
  { category: "expression", words: /\b(expression|smile|smiling|gaze|gazing|looking|staring|grin|thoughtful)\b/i },
];

const HF_REJECT =
  /^(use|do not|don't|keep|ensure|maintain|preserve|create|capture|this |the image|uploaded|reference|same person|there is|she is|he is|it is|we |imagine|envision|a portrait|an? \w+ portrait|the \w+ portrait)/i;
const HF_DANGLING = /(with|of|and|in|on|at|for|as|to|by|from|her|his|their|its)$/i;

/**
 * 20k English photoreal prompts. Free prose has no field labels, so only
 * frequent (>=3) short clauses that contain a visual keyword are kept; this
 * keeps reusable descriptors and drops one-off narrative.
 */
function fromHfPhotoreal(): Term[] {
  if (!fs.existsSync(HF_PROMPTS)) return [];
  const counts = new Map<string, { text: string; category: string; n: number }>();
  for (const line of fs.readFileSync(HF_PROMPTS, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    let prompt = "";
    try {
      prompt = String((JSON.parse(line) as { prompt?: string }).prompt ?? "");
    } catch {
      continue;
    }
    for (const raw of prompt.split(/[,;.\n]/)) {
      const clause = raw.replace(/\s+/g, " ").trim().replace(/[)"'”’]+$/g, "");
      if (clause.length < 4 || clause.length > 50) continue;
      if (clause.split(" ").length > 9) continue;
      if (HF_REJECT.test(clause)) continue;
      if (clause.includes("reference") || clause.includes("uploaded")) continue;
      if (/^(her|his|the|their)\s+\w+$/i.test(clause)) continue;
      if (/^(in the|the|a|an)\s+(background|backdrop|portrait|portrait photograph|portrait photo|unique perspective|camera angle)$/i.test(clause)) continue;
      if (/(soft|warm|cool|bright|dark|deep|full|high|low|pale|golden|natural|dramatic|subtle|rich|vibrant|delicate)$/i.test(clause)) continue;
      if (HF_DANGLING.test(clause)) continue;
      const hit = HF_LEXICON.find((entry) => entry.words.test(clause));
      if (!hit) continue;
      if (
        hit.category === "camera" &&
        (/^(a|an|the|craft|create)\b/i.test(clause) || /portrait$/i.test(clause))
      ) {
        continue;
      }
      const key = `${hit.category}\u0000${clause.toLowerCase()}`;
      const entry = counts.get(key);
      if (entry) entry.n += 1;
      else counts.set(key, { text: clause, category: hit.category, n: 1 });
    }
  }

  const terms: Term[] = [];
  for (const { text, category, n } of counts.values()) {
    if (n < 3) continue;
    const digest = crypto.createHash("sha1").update(text).digest("hex").slice(0, 10);
    terms.push({
      id: `hf:${category}:${digest}`,
      category,
      subcategory: "HF真人语料",
      en: text,
      zh: null,
      source: "hf-photoreal-prompts",
      domain: category === "camera" ? "real" : "shared",
    });
  }
  return terms;
}

/** Field guess for Chinese photographic phrases; first match wins. */
function classifyPhotographicPhrase(text: string): string {
  if (/光|闪|逆光|柔雾|过曝|高光|阴影|剪影|泛白|泛朦|halation|bloom/i.test(text)) return "lighting";
  if (/镜头|机位|广角|长焦|景深|焦距|低角度|lens|\d+mm/i.test(text)) return "camera";
  if (/构图|裁切|前景|框中框|留白|居中|对称|三分|视角/i.test(text)) return "composition";
  if (/妆|唇|腮红|眼影|睫毛|底妆|卧蚕|皮肤|毛孔|肤色|雀斑|五官/i.test(text)) return "face";
  if (/发|刘海|马尾|盘发|卷发|发丝|发饰/i.test(text)) return "hair";
  if (/服饰|服装|裙|衬衫|上装|下装|材质|面料|饰品|耳环|项链|帽子|丝带/i.test(text)) return "clothing";
  if (/表情|笑|挑眉|wink|鼓脸|嘟嘴|吐舌|眼神|直视|垂眼/i.test(text)) return "expression";
  if (/坐|站|蹲|躺|抬手|低头|手扶|手拿|奔跑|姿态|动作|身体|侧身|前倾/i.test(text)) return "pose";
  if (/场景|海边|室内|书房|沙滩|花田|卧室|果园|便利店|阳台|街道|咖啡馆|背景/i.test(text)) return "environment";
  return "style";
}

const NUYOAH_ALLOWED = [
  "写真探索先人物", "风格要写成成像方式", "妆容写最小可识别锚点",
  "动作写骨架", "动作表情随机", "场景元素池", "高频风格入口", "高频成像词",
];

/**
 * nuyoah is a rules document. Only its explicit enumerations are used: the
 * `成立：` lists, the style-entry tables and the makeup/action/scene examples.
 */
const NUYOAH_STOP = new Set([
  "服装", "服饰", "材质", "饰品", "发型", "场景", "光线", "表情", "动作",
  "构图", "镜头", "道具", "妆容", "关系", "元素", "背景", "身体",
]);
const NUYOAH_RULE = /^(不|只|要|需|应|提|写|列|把|用|从|按|将|让|保|默|固|可|例|如|但|而|也|这|那|其|每|同|以|在|对|为|是|有|无|没|请|原)|服务|模块|具体|地点|变量|逻辑|锚点|骨架|关系|场景模块|P0\d/;

function fromNuyoah(): Term[] {
  if (!fs.existsSync(NUYOAH_LOGIC)) return [];
  const terms: Term[] = [];
  const seen = new Set<string>();
  const push = (raw: string, fallback: string) => {
    const text = raw
      .replace(/`/g, "")
      .replace(/^\*+|\*+$/g, "")
      .replace(/[。；;，,、]+$/g, "")
      .trim();
    if (text.length < 2 || text.length > 20) return;
    if (NUYOAH_STOP.has(text)) return;
    if (NUYOAH_RULE.test(text)) return;
    if (/要有|服务|模块|具体|地点|变量|逻辑|锚点|骨架|关系/.test(text)) return;
    if (/^image-?\d+$|^P0\d$/i.test(text)) return;
    if (/例如|必须|不要|不能|可以|需要|保持|避免|优先|默认|属于|而不是/.test(text)) return;
    const category = fallback === "auto" ? classifyPhotographicPhrase(text) : fallback;
    const key = `${category}\u0000${text.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    const digest = crypto.createHash("sha1").update(text).digest("hex").slice(0, 10);
    terms.push({
      id: `nuyoah:${category}:${digest}`,
      category,
      subcategory: "写真法则",
      en: text,
      zh: null,
      source: "nuyoah-xiezhen-prompt",
      domain: category === "style" ? "real" : "shared",
    });
  };

  let section = "";
  for (const line of fs.readFileSync(NUYOAH_LOGIC, "utf8").split(/\r?\n/)) {
    if (/^#{2,3}\s/.test(line)) {
      section = line.replace(/^#+\s*/, "").trim();
      continue;
    }
    if (!NUYOAH_ALLOWED.some((name) => section.includes(name))) continue;
    const bullet = /^-\s+(.+)$/.exec(line.trim());
    if (!bullet) continue;
    const body = bullet[1].trim();
    const split = body.search(/[：:]/);
    const isStyleEntry = section.includes("高频风格入口") || section.includes("高频成像词");
    if (split > 0) {
      const left = body.slice(0, split).trim();
      const right = body.slice(split + 1).trim();
      if (isStyleEntry) push(left, "style");
      for (const part of right.split(/[、，,/]/)) push(part, "auto");
      continue;
    }
    for (const part of body.split(/[、，,]/)) push(part, isStyleEntry ? "style" : "auto");
  }

  // Pure-English inline terms such as `35mm film photography` / `film halation`.
  for (const match of fs.readFileSync(NUYOAH_LOGIC, "utf8").matchAll(/`([^`\n]{2,40})`/g)) {
    const text = match[1].trim();
    if (!/^[A-Za-z0-9 /+.-]+$/.test(text)) continue;
    const category = /mm|flash|ccd|film|lens|camera|photography/i.test(text) ? "style" : "lighting";
    push(text, category);
  }
  return terms;
}

/** Recurring style/medium phrases in the Awesome gallery; one-offs are ignored. */
const AWESOME_PHRASES: Array<{ text: string; category: string }> = [
  { text: "photorealistic", category: "style" },
  { text: "cinematic", category: "style" },
  { text: "miniature", category: "composition" },
  { text: "close-up", category: "camera" },
  { text: "3d render", category: "style" },
  { text: "minimalist", category: "style" },
  { text: "studio lighting", category: "lighting" },
  { text: "surreal", category: "style" },
  { text: "bokeh", category: "camera" },
  { text: "collage", category: "style" },
  { text: "golden hour", category: "lighting" },
  { text: "watercolor", category: "style" },
  { text: "35mm", category: "camera" },
  { text: "high contrast", category: "lighting" },
  { text: "product photography", category: "composition" },
  { text: "film grain", category: "style" },
  { text: "cyberpunk", category: "style" },
  { text: "cinematic lighting", category: "lighting" },
  { text: "low angle", category: "camera" },
  { text: "diorama", category: "composition" },
  { text: "pixel art", category: "style" },
  { text: "analog", category: "style" },
  { text: "isometric", category: "composition" },
  { text: "vector art", category: "style" },
  { text: "origami", category: "style" },
  { text: "flat lay", category: "composition" },
  { text: "monochrome", category: "style" },
  { text: "food photography", category: "composition" },
  { text: "macro photography", category: "camera" },
  { text: "oil painting", category: "style" },
  { text: "claymation", category: "style" },
  { text: "hyperrealistic", category: "style" },
  { text: "wide angle", category: "camera" },
  { text: "octane render", category: "style" },
  { text: "unreal engine", category: "style" },
  { text: "chibi", category: "style" },
  { text: "paper art", category: "style" },
  { text: "double exposure", category: "camera" },
  { text: "long exposure", category: "camera" },
  { text: "pastel colors", category: "style" },
];

function fromAwesomePrompts(): Term[] {
  if (!fs.existsSync(AWESOME_README)) return [];
  const readme = fs.readFileSync(AWESOME_README, "utf8");
  const terms: Term[] = [];
  const seen = new Set<string>();
  const push = (text: string, category: string) => {
    const key = `${category}\u0000${text.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    const digest = crypto.createHash("sha1").update(text).digest("hex").slice(0, 10);
    const threeD = /3d|octane|unreal|render/i.test(text);
    terms.push({
      id: `awesome:${category}:${digest}`,
      category,
      subcategory: "Awesome 主题",
      en: text,
      zh: null,
      source: "awesome-ai-image-prompts",
      domain: threeD ? "3d" : "shared",
    });
  };

  for (const phrase of AWESOME_PHRASES) {
    const pattern = new RegExp(`\\b${phrase.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    const hits = readme.match(pattern) ?? [];
    if (hits.length >= 2) push(phrase.text, phrase.category);
  }
  for (const heading of readme.match(/^##\s+\d+\.\s+(.+)$/gm) ?? []) {
    const title = heading.replace(/^##\s+\d+\.\s+/, "").replace(/^[^\w\u4e00-\u9fa5]+/, "").trim();
    if (title.length < 3 || title.length > 40) continue;
    push(title, "style");
  }
  return terms;
}

interface ActiveRow {
  id: string;
  en: string;
  category: string;
  subcategory: string | null;
  source: string | null;
  created_at: number;
}

/** When one term lived in several fields, keep the most semantically specific one. */
const NSFW_FIELD_PRIORITY = [
  "expression", "pose", "accessory", "clothing", "body", "face", "props", "style", "camera",
];

/**
 * One visible row per explicit adult term. The oldest non-workbench row keeps
 * its ID (so existing selections stay valid) and moves into `nsfw`; every other
 * duplicate is deprecated rather than deleted, which removes it from search
 * while preserving relations and historical references.
 */
function mergeNsfwDuplicates(db: DatabaseAdapter): { moved: number; deprecated: number } {
  const rows = db
    .prepare(
      `SELECT id, en, category, subcategory, source, created_at
       FROM prompt_terms
       WHERE validation_status <> 'deprecated'
         AND lower(en) IN (
           SELECT lower(en) FROM prompt_terms
           WHERE category = 'nsfw' AND validation_status <> 'deprecated'
         )
       ORDER BY lower(en), created_at, id`,
    )
    .all() as ActiveRow[];
  const groups = new Map<string, ActiveRow[]>();
  for (const row of rows) {
    const key = row.en.toLowerCase();
    const bucket = groups.get(key) ?? [];
    bucket.push(row);
    groups.set(key, bucket);
  }
  const move = db.prepare(
    "UPDATE prompt_terms SET category = 'nsfw', subcategory = ? WHERE id = ?",
  );
  const deprecate = db.prepare(
    "UPDATE prompt_terms SET validation_status = 'deprecated' WHERE id = ?",
  );
  let moved = 0;
  let deprecated = 0;
  for (const bucket of groups.values()) {
    if (bucket.length < 2 && bucket[0].category === "nsfw") continue;
    const fieldRank = (category: string) => {
    const index = NSFW_FIELD_PRIORITY.indexOf(category);
    return index < 0 ? NSFW_FIELD_PRIORITY.length : index;
  };
  const canonical =
      bucket
        .filter((row) => row.source !== "prompt-workbench")
        .sort(
          (left, right) =>
            fieldRank(left.category) - fieldRank(right.category) ||
            left.created_at - right.created_at,
        )[0] ?? bucket[0];
    if (canonical.category !== "nsfw") {
      move.run(canonical.subcategory ?? canonical.category, canonical.id);
      moved += 1;
    }
    for (const row of bucket) {
      if (row.id === canonical.id) continue;
      deprecate.run(row.id);
      deprecated += 1;
    }
  }
  return { moved, deprecated };
}

function main(): void {
  const dbPath = process.argv[2];
  if (!dbPath) throw new Error("Pass the sqlite database path as the first argument");

  const all = [
    ...fromTaglib(),
    ...fromTagcats(),
    ...fromGenerator(),
    ...fromWorkbench(),
    ...fromPortraitAtlas(),
    ...fromShuixian(),
    ...fromCysVocabulary(),
    ...fromMagazineScenes(),
    ...fromHfPhotoreal(),
    ...fromNuyoah(),
    ...fromAwesomePrompts(),
  ];
  const seen = new Set<string>();
  const unique = all.filter((term) => {
    const key = `${term.category}\u0000${term.en}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const db = new DatabaseAdapter(dbPath);
  migratePromptVocabSchema(db);
  const insert = db.prepare(
    `INSERT OR IGNORE INTO prompt_terms (
       id, category, subcategory, en, zh, series, template, "function",
       applicable_task, applicable_models, source, domain, validation_status, created_at
     ) VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, '[]', ?, ?, 'unvalidated', ?)`,
  );

  const findLegacy = db.prepare(
    `SELECT id, category, subcategory, en, zh, domain FROM prompt_terms
     WHERE id = ? AND source = 'skyloong-taglib'`,
  );
  const updateLegacy = db.prepare(
    "UPDATE prompt_terms SET category = ?, subcategory = ?, en = ?, zh = ?, domain = ? WHERE id = ?",
  );
  /** Corpus sources are rebuilt so filter changes take effect on re-import. */
  const purgeCorpus = db.prepare(
    `DELETE FROM prompt_terms WHERE source IN (
       'prompt-workbench', 'portrait-prompt-atlas', 'shuixian-prompts',
       'cys-portrait-prompts', 'ai-magazine-photographer', 'hf-photoreal-prompts',
       'nuyoah-xiezhen-prompt', 'awesome-ai-image-prompts'
     )`,
  );

  let inserted = 0;
  let updated = 0;
  let skipped = all.length - unique.length;
  const now = Date.now();
  const run = db.transaction(() => {
    purgeCorpus.run();
    const repairedLegacyIds = new Set<string>();
    const processedLegacyIds = new Set<string>();
    for (const term of all) {
      if (!term.legacyId || processedLegacyIds.has(term.legacyId)) continue;
      processedLegacyIds.add(term.legacyId);
      const legacy = findLegacy.get(term.legacyId) as
        | { category: string; subcategory: string | null; en: string; zh: string | null; domain: Domain }
        | undefined;
      if (!legacy) continue;
      // Adult terms keep their NSFW placement; do not re-insert or re-file them.
      if (legacy.category === "nsfw") {
        repairedLegacyIds.add(term.legacyId);
        skipped += 1;
        continue;
      }
      if (
        legacy.category !== term.category ||
        legacy.subcategory !== term.subcategory ||
        legacy.en !== term.en ||
        legacy.zh !== term.zh ||
        legacy.domain !== term.domain
      ) {
        updateLegacy.run(term.category, term.subcategory, term.en, term.zh, term.domain, term.legacyId);
        updated += 1;
      } else {
        skipped += 1;
      }
      // Keep the old primary key so existing selections and relations remain valid.
      repairedLegacyIds.add(term.legacyId);
    }

    for (const term of unique) {
      if (term.legacyId && repairedLegacyIds.has(term.legacyId)) continue;
      const result = insert.run(
        term.id,
        term.category,
        term.subcategory,
        term.en,
        term.zh,
        term.source,
        term.domain,
        now,
      );
      if (result.changes > 0) inserted += 1;
      else skipped += 1;
    }
  });
  run();

  // Rows imported before the domain column existed default to shared; classify
  // the anime/photo/3D signifiers once so filtering works without a re-import.
  const pending = db
    .prepare("SELECT id, category, en FROM prompt_terms WHERE domain = 'shared'")
    .all() as Array<{ id: string; category: string; en: string }>;
  const setDomain = db.prepare("UPDATE prompt_terms SET domain = ? WHERE id = ?");
  let domainsUpdated = 0;
  db.transaction(() => {
    for (const row of pending) {
      const domain = inferDomain(row.category, row.en);
      if (domain === "shared") continue;
      setDomain.run(domain, row.id);
      domainsUpdated += 1;
    }
  })();

  const nsfwMerge = mergeNsfwDuplicates(db);

  const total = db.prepare("SELECT COUNT(*) AS n FROM prompt_terms").get() as { n: number };
  const byCategory = db
    .prepare("SELECT category, COUNT(*) AS n FROM prompt_terms GROUP BY category ORDER BY n DESC")
    .all() as Array<{ category: string; n: number }>;
  const byDomain = db
    .prepare("SELECT domain, COUNT(*) AS n FROM prompt_terms GROUP BY domain ORDER BY n DESC")
    .all() as Array<{ domain: string; n: number }>;
  const bySource = db
    .prepare("SELECT source, COUNT(*) AS n FROM prompt_terms GROUP BY source ORDER BY n DESC")
    .all() as Array<{ source: string; n: number }>;
  console.log(
    JSON.stringify(
      {
        inserted,
        updated,
        skipped,
        domainsUpdated,
        nsfwMoved: nsfwMerge.moved,
        nsfwDeprecated: nsfwMerge.deprecated,
        total: total.n,
        byCategory,
        byDomain,
        bySource,
      },
      null,
      1,
    ),
  );
  db.close();
}

main();