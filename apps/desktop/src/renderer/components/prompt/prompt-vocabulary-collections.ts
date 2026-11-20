import type { PromptVocabularySearchItem } from "@prompthub/shared/types";
import { resolveTermKey } from "@prompthub/shared/utils/prompt-term-key";

/**
 * Curated style/medium packs and preset combos.
 *
 * Every pack is a projection of categories and subcategories that already exist
 * in the vocabulary, so a pack can never invent an entry: terms are read from
 * `prompt_terms` at runtime and a pack with too few real matches is not shown.
 * Presets reference real reference-library tags and are resolved through
 * `promptOrchestrator.resolveTerms`; unresolved tags simply do not appear.
 */

export type VocabularyCollectionGroup = "style" | "medium";

interface L10n {
  zh: string;
  en: string;
}

/** Chinese locales read the zh string; everything else falls back to English. */
export function localized(value: L10n, language: string): string {
  return language.toLowerCase().startsWith("zh") ? value.zh : value.en;
}

export interface VocabularyPackSource {
  category: string;
  /** Omit to take every term of the category. */
  subcategory?: string;
  /** Exact English terms; omit to take the whole subcategory. */
  only?: readonly string[];
}

export interface VocabularyPack {
  id: string;
  group: VocabularyCollectionGroup;
  name: L10n;
  description: L10n;
  sources: readonly VocabularyPackSource[];
}

/** Categories needed to resolve every pack in one catalog pass. */
export const PACK_CATEGORIES = ["style", "camera", "lighting"] as const;

/** A pack needs enough real terms to be worth a browsing scope. */
export const MIN_PACK_TERMS = 3;
/** A preset needs enough resolved tags to be a usable starting point. */
export const MIN_PRESET_TERMS = 6;

const QUALITY = "质量与风格";
const OVERALL = "总体画风";
const ART_STYLE = "艺术风格";
const ART_TYPE = "艺术类型";
const MODEL_STYLE = "作品与模型风";
const RENDER_SUB = "镜头与渲染";
const LIGHT_SUB = "光照";

export const VOCABULARY_PACKS: readonly VocabularyPack[] = [
  {
    id: "anime-cel",
    group: "style",
    name: { zh: "动漫 · 赛璐璐", en: "Anime / cel" },
    description: {
      zh: "日漫平涂与赛璐璐阴影，画师另见「画师 · 赛璐璐/动画风」。",
      en: "Flat anime colouring and cel shading. Artists live under the artist field.",
    },
    sources: [
      {
        category: "style",
        subcategory: QUALITY,
        only: [
          "cel shading",
          "anime coloring",
          "manga style",
          "comic style",
          "lineart",
          "clean lineart",
          "chibi",
          "thick outlines",
        ],
      },
      { category: "style", subcategory: OVERALL, only: ["celluloid style", "japanese and korean style"] },
      { category: "style", subcategory: ART_STYLE, only: ["1980s anime", "4koma", "Studio Ghibli"] },
    ],
  },
  {
    id: "thick-paint",
    group: "style",
    name: { zh: "厚涂 · 半写实", en: "Thick paint / semi-real" },
    description: {
      zh: "厚涂与半写实，适合 2.5D 质感；画师另见「画师 · 厚涂/半厚涂」。",
      en: "Painterly and semi-real rendering for a 2.5D look.",
    },
    sources: [
      {
        category: "style",
        subcategory: QUALITY,
        only: ["painterly", "semi-realistic", "digital painting", "concept art", "stylized", "intricate details"],
      },
      { category: "style", subcategory: MODEL_STYLE, only: ["semi-thick painting"] },
    ],
  },
  {
    id: "cyber-scifi",
    group: "style",
    name: { zh: "赛博朋克 · 科幻", en: "Cyberpunk / sci-fi" },
    description: {
      zh: "赛博朋克、蒸汽朋克与科幻题材，配霓虹光照。",
      en: "Cyberpunk, steampunk and sci-fi themes with neon lighting.",
    },
    sources: [
      {
        category: "style",
        subcategory: OVERALL,
        only: ["cyberpunk style", "science fiction style", "steampunk style", "gothic style", "surreal style"],
      },
      {
        category: "style",
        subcategory: ART_STYLE,
        only: ["synthwave", "((dieselpunk))", "rebecca \\(cyberpunk\\)", "science fiction", "goth"],
      },
      { category: "lighting", subcategory: LIGHT_SUB, only: ["glowing neon lights", "glowing_light", "floating_lights"] },
    ],
  },
  {
    id: "retro-era",
    group: "style",
    name: { zh: "复古 · 年代", en: "Retro / era" },
    description: {
      zh: "80/90/00 年代画风与胶片质感。",
      en: "80s/90s/00s styling with analog film texture.",
    },
    sources: [
      {
        category: "style",
        subcategory: QUALITY,
        only: ["1980s style", "1990s style", "2000s style", "retro artstyle", "muted colors", "desaturated", "screentone"],
      },
      { category: "style", subcategory: OVERALL, only: ["retro style"] },
      { category: "style", subcategory: ART_STYLE, only: ["80s movie", "Polaroid art"] },
      { category: "camera", subcategory: RENDER_SUB, only: ["film grain", "polaroid", "analog photo"] },
    ],
  },
  {
    id: "watercolor-ink",
    group: "medium",
    name: { zh: "水彩 · 水墨", en: "Watercolour / ink" },
    description: {
      zh: "透明水彩、水墨与国风媒介。",
      en: "Transparent watercolour, ink wash and East-Asian media.",
    },
    sources: [
      {
        category: "style",
        subcategory: ART_TYPE,
        only: [
          "(((ink))), ((watercolor))",
          "((wash painting)),((ink s...))",
          "Ink wash painting",
          "(watercolor pencil)",
        ],
      },
      {
        category: "style",
        subcategory: "画笔",
        only: ["watercolor_\\(medium\\)", "watercolour", "watercolour_pencil", "gouache"],
      },
      { category: "style", subcategory: QUALITY, only: ["watercolor", "ink painting"] },
      { category: "style", subcategory: OVERALL, only: ["ink wash painting"] },
    ],
  },
  {
    id: "oil-acrylic",
    group: "medium",
    name: { zh: "油画 · 丙烯", en: "Oil / acrylic" },
    description: {
      zh: "油画、丙烯与厚涂颜料质感。",
      en: "Oil, acrylic and impasto paint media.",
    },
    sources: [
      {
        category: "style",
        subcategory: ART_TYPE,
        only: ["((dyeing)),((oil painting)),((impasto))", "Encaustic painting"],
      },
      { category: "style", subcategory: "写实", only: ["oil_painting"] },
      { category: "style", subcategory: "画笔", only: ["acrylic_paint", "acrylic_paint_\\(medium\\)", "pastel_color"] },
      { category: "style", subcategory: QUALITY, only: ["oil painting"] },
    ],
  },
  {
    id: "pencil-line",
    group: "medium",
    name: { zh: "铅笔 · 线稿", en: "Pencil / line art" },
    description: {
      zh: "铅笔、炭笔、马克笔与单色线稿。",
      en: "Pencil, graphite, marker and monochrome line art.",
    },
    sources: [
      { category: "style", subcategory: "素描" },
      {
        category: "style",
        subcategory: "画笔",
        only: [
          "pencil_sketch_lines",
          "graphite_\\(medium\\)",
          "colored_pencil_\\(medium\\)",
          "ballpoint_pen_\\(medium\\)",
          "millipen_\\(medium\\)",
          "nib_pen_\\(medium\\)",
          "copics",
          "marker_\\(medium\\)",
          "crayon_drawing",
          "pencil_crayon_\\(medium\\)",
        ],
      },
      {
        category: "style",
        subcategory: ART_TYPE,
        only: ["(monochrome), (gray scale), (pencil sketch lines", "(posing sketch), (monochrome)", "sketch", "monochrome"],
      },
    ],
  },
  {
    id: "pixel-lowpoly",
    group: "medium",
    name: { zh: "像素 · 低多边形", en: "Pixel / low-poly" },
    description: {
      zh: "像素画、8bit 与低多边形。",
      en: "Pixel art, 8-bit and low-poly styling.",
    },
    sources: [
      { category: "style", subcategory: "画质", only: ["pixel art"] },
      { category: "style", subcategory: ART_STYLE, only: ["8 Bit Game"] },
      { category: "style", subcategory: QUALITY, only: ["low poly", "flat design", "vector art"] },
    ],
  },
  {
    id: "photo-real",
    group: "medium",
    name: { zh: "摄影 · 写实", en: "Photo / realistic" },
    description: {
      zh: "照片媒介、写实与单反/手机摄影参数。",
      en: "Photographic media with DSLR and phone-camera cues.",
    },
    sources: [
      { category: "style", subcategory: "写实" },
      {
        category: "camera",
        subcategory: RENDER_SUB,
        only: [
          "dslr",
          "photorealistic",
          "film photography",
          "analog photo",
          "smartphone photo",
          "sharp focus",
          "shallow depth of field",
          "deep depth of field",
          "long exposure",
          "high shutter speed",
          "low shutter speed",
          "hdr",
          "color grading",
          "soft focus",
        ],
      },
    ],
  },
  {
    id: "render-3d",
    group: "medium",
    name: { zh: "3D · 渲染", en: "3D / render" },
    description: {
      zh: "三维渲染、光线追踪与引擎画质。",
      en: "3D rendering, ray tracing and engine quality cues.",
    },
    sources: [
      {
        category: "camera",
        subcategory: RENDER_SUB,
        only: [
          "3d render",
          "cgi render",
          "octane render",
          "unreal engine",
          "ray tracing",
          "global illumination",
          "ambient occlusion",
          "subsurface scattering",
          "tonemapping",
          "screen space reflections",
          "hyperdetailed",
        ],
      },
      { category: "style", subcategory: OVERALL, only: ["blender \\(medium\\)"] },
    ],
  },
];

export interface VocabularyPreset {
  id: string;
  name: L10n;
  description: L10n;
  terms: readonly string[];
}

/**
 * Adapted from the reference generator's 26 built-in presets
 * (`prompt/提示词生成器v3.0`, `window.PG_PRESETS`). Tags are kept verbatim;
 * whatever the local library does not contain is dropped at resolve time.
 */
export const VOCABULARY_PRESETS: readonly VocabularyPreset[] = [
  {
    id: "full-body",
    name: { zh: "全身立绘", en: "Full-body sheet" },
    description: { zh: "纯背景 + 正面全身，适合做角色卡", en: "Plain backdrop, front-facing full body." },
    terms: [
      "1girl", "solo", "full body", "from front", "standing", "simple background",
      "white background", "looking at viewer", "official art", "best quality",
    ],
  },
  {
    id: "bust-closeup",
    name: { zh: "半身特写", en: "Bust close-up" },
    description: { zh: "胸部以上，突出表情与眼神", en: "Chest-up framing on expression and gaze." },
    terms: [
      "1girl", "portrait", "upper body", "close-up", "looking at viewer",
      "depth of field", "detailed face", "soft lighting",
    ],
  },
  {
    id: "summer-melt",
    name: { zh: "夏日瘫软", en: "Summer melt" },
    description: { zh: "电扇前的暑气溃败", en: "Heat-struck slump in front of a fan." },
    terms: [
      "1girl", "solo", "sitting on floor", "slumped", "leaning back", "legs spread",
      "arms limp", "closed eyes", "open mouth", "blush", "sweat", "exhausted",
      "electric fan", "summer", "hair blown by fan", "sitting in front of electric fan",
    ],
  },
  {
    id: "rainy-rooftop",
    name: { zh: "雨中天台", en: "Rainy rooftop" },
    description: { zh: "湿发与积水反光", en: "Wet hair and puddled reflections." },
    terms: [
      "1girl", "rain", "rainy day", "rooftop", "wet hair", "wet clothes",
      "looking up", "overcast", "cinematic lighting", "reflection", "city", "depth of field",
    ],
  },
  {
    id: "sakura",
    name: { zh: "樱花树下", en: "Under the sakura" },
    description: { zh: "春日花瓣与柔光", en: "Spring petals and soft light." },
    terms: [
      "1girl", "cherry blossoms", "spring", "tree", "petals", "wind",
      "hair blown by wind", "sunlight", "soft lighting", "kimono", "smile",
    ],
  },
  {
    id: "cyber-night",
    name: { zh: "赛博夜街", en: "Cyber night street" },
    description: { zh: "霓虹雨夜的都市感", en: "Neon and rain in a dense city." },
    terms: [
      "1girl", "night", "city", "neon lights", "rain", "wet street", "cyberpunk",
      "glowing", "backlighting", "reflection", "techwear", "hoodie",
    ],
  },
  {
    id: "classroom",
    name: { zh: "教室午后", en: "Afternoon classroom" },
    description: { zh: "斜阳与课桌", en: "Slanted sun and school desks." },
    terms: [
      "1girl", "classroom", "afternoon", "sunlight", "window", "desk",
      "school uniform", "sitting", "reading", "lens flare", "warm lighting",
    ],
  },
  {
    id: "shrine",
    name: { zh: "神社参拜", en: "Shrine visit" },
    description: { zh: "石阶、鸟居与巫女", en: "Stone steps, torii and a miko." },
    terms: [
      "1girl", "shrine", "torii", "stone stairs", "miko", "japanese clothes",
      "autumn", "maple leaves", "lantern", "traditional", "dappled sunlight",
    ],
  },
  {
    id: "winter-scarf",
    name: { zh: "冬日围巾", en: "Winter scarf" },
    description: { zh: "雪地呼出的白气", en: "Breath visible in the snow." },
    terms: [
      "1girl", "winter", "snow", "snowing", "scarf", "coat", "gloves", "breath",
      "blush", "cold", "white breath", "pale skin",
    ],
  },
  {
    id: "seaside-dusk",
    name: { zh: "海边黄昏", en: "Seaside dusk" },
    description: { zh: "逆光剪影与浪花", en: "Backlit silhouette and breaking waves." },
    terms: [
      "1girl", "beach", "ocean", "sunset", "golden hour", "backlighting", "wind",
      "dress", "barefoot", "waves", "cinematic",
    ],
  },
  {
    id: "magical-girl",
    name: { zh: "魔法少女", en: "Magical girl" },
    description: { zh: "变身特效与魔法阵", en: "Transformation effects and magic circles." },
    terms: [
      "1girl", "magical girl", "magic circle", "glowing", "sparkle", "frilled dress",
      "ribbon", "wand", "floating", "starry sky", "dynamic pose", "energy",
    ],
  },
  {
    id: "combat",
    name: { zh: "战斗姿态", en: "Combat stance" },
    description: { zh: "刀光与速度线", en: "Blade light and speed lines." },
    terms: [
      "1girl", "fighting stance", "sword", "holding sword", "dynamic pose",
      "motion blur", "speed lines", "action", "serious", "armor", "sparks",
    ],
  },
  {
    id: "library",
    name: { zh: "图书馆阅读", en: "Library reading" },
    description: { zh: "暖灯与成堆的书", en: "Warm lamps and stacked books." },
    terms: [
      "1girl", "library", "bookshelf", "book", "reading", "glasses", "sitting",
      "warm lighting", "indoors", "quiet", "depth of field",
    ],
  },
  {
    id: "cafe",
    name: { zh: "咖啡店打工", en: "Cafe shift" },
    description: { zh: "围裙与服务生", en: "Apron and counter service." },
    terms: [
      "1girl", "cafe", "apron", "waiter", "holding tray", "smile", "indoors",
      "warm lighting", "counter", "coffee",
    ],
  },
  {
    id: "monochrome-lineart",
    name: { zh: "黑白线稿", en: "Black-and-white line art" },
    description: { zh: "单色线画，适合上色底稿", en: "Monochrome line work for later colouring." },
    terms: [
      "1girl", "monochrome", "lineart", "greyscale", "sketch", "white background",
      "simple background", "clean lines",
    ],
  },
  {
    id: "retro-film",
    name: { zh: "复古胶片", en: "Retro film" },
    description: { zh: "颗粒、漏光、褪色", en: "Grain, light leaks and faded colour." },
    terms: [
      "1girl", "film grain", "vintage", "light leak", "faded colors", "analog",
      "35mm film", "soft focus", "nostalgic",
    ],
  },
  {
    id: "starry-camp",
    name: { zh: "星空露营", en: "Starry camp" },
    description: { zh: "银河与篝火", en: "Milky way and campfire." },
    terms: [
      "1girl", "night", "starry sky", "milky way", "campfire", "tent", "camping",
      "bonfire", "mountains", "glowing", "wide shot",
    ],
  },
  {
    id: "ruins",
    name: { zh: "废墟探索", en: "Ruin exploration" },
    description: { zh: "断壁与藤蔓", en: "Broken walls and vines." },
    terms: [
      "1girl", "ruins", "broken building", "vines", "overgrown", "dust", "god rays",
      "exploring", "backpack", "muted colors",
    ],
  },
  {
    id: "idol-stage",
    name: { zh: "偶像舞台", en: "Idol stage" },
    description: { zh: "聚光灯与荧光棒", en: "Spotlights and glow sticks." },
    terms: [
      "1girl", "stage", "spotlight", "idol", "microphone", "singing", "glowing",
      "confetti", "dynamic pose", "crowd",
    ],
  },
  {
    id: "pajama-morning",
    name: { zh: "睡衣清晨", en: "Pajama morning" },
    description: { zh: "刚醒来的松弛感", en: "Just-woke-up looseness." },
    terms: [
      "1girl", "bedroom", "morning", "pajamas", "messy hair", "bed", "yawning",
      "sleepy", "sunlight", "soft lighting", "sitting on bed",
    ],
  },
  {
    id: "rainy-window",
    name: { zh: "雨天窗边", en: "Rainy window" },
    description: { zh: "玻璃上的水痕", en: "Water trails on the glass." },
    terms: [
      "1girl", "rain", "window", "raindrops on glass", "indoors", "sitting",
      "chin on hand", "looking outside", "moody", "cool colors",
    ],
  },
  {
    id: "dragon",
    name: { zh: "龙与少女", en: "Dragon and girl" },
    description: { zh: "奇幻巨兽与小小身影", en: "A tiny figure before a huge beast." },
    terms: [
      "1girl", "dragon", "fantasy", "epic", "scale", "horns", "floating island",
      "clouds", "wide shot", "cinematic lighting",
    ],
  },
  {
    id: "ink-wash",
    name: { zh: "水墨和风", en: "Ink wash" },
    description: { zh: "留白、墨迹、和纸质感", en: "Negative space, ink and washi texture." },
    terms: [
      "1girl", "ink wash painting", "sumi-e", "japanese style", "negative space",
      "paper texture", "monochrome", "elegant", "kimono",
    ],
  },
  {
    id: "pixel-game",
    name: { zh: "像素游戏", en: "Pixel game" },
    description: { zh: "16bit 复古游戏画面", en: "16-bit era game screen." },
    terms: [
      "1girl", "pixel art", "16-bit", "retro game", "dithering", "limited palette",
      "side view", "game ui",
    ],
  },
  {
    id: "mecha",
    name: { zh: "机甲少女", en: "Mecha girl" },
    description: { zh: "机械外骨骼与冷光", en: "Exoskeleton and cold light." },
    terms: [
      "1girl", "mecha", "mecha musume", "robot", "armor", "glowing", "hangar",
      "science fiction", "metal", "blue lighting",
    ],
  },
  {
    id: "flower-field",
    name: { zh: "花海仰望", en: "Flower field gaze" },
    description: { zh: "躺着看天，前景虚化", en: "Lying down, sky above, soft foreground." },
    terms: [
      "1girl", "flower field", "lying", "looking up", "blue sky", "clouds",
      "from above", "shallow depth of field", "peaceful", "petals",
    ],
  },
];

/**
 * Project a pack onto real catalog rows, preserving source order. Terms from a
 * whole subcategory come first, then explicitly listed ones in definition order.
 */
export function resolvePackTerms(
  pack: VocabularyPack,
  catalog: readonly PromptVocabularySearchItem[],
): PromptVocabularySearchItem[] {
  const byCategory = new Map<string, PromptVocabularySearchItem[]>();
  for (const term of catalog) {
    const bucket = byCategory.get(term.category) ?? [];
    bucket.push(term);
    byCategory.set(term.category, bucket);
  }
  const seen = new Set<string>();
  const output: PromptVocabularySearchItem[] = [];
  const push = (term: PromptVocabularySearchItem) => {
    const key = resolveTermKey(term.en);
    if (seen.has(key)) return;
    seen.add(key);
    output.push(term);
  };
  for (const source of pack.sources) {
    const terms = (byCategory.get(source.category) ?? []).filter(
      (term) =>
        (!source.subcategory || (term.subcategory?.trim() ?? "") === source.subcategory) &&
        (!source.only || source.only.some((value) => resolveTermKey(value) === resolveTermKey(term.en))),
    );
    if (!source.only) {
      for (const term of terms) push(term);
      continue;
    }
    for (const wanted of source.only) {
      const key = resolveTermKey(wanted);
      const match = terms.find((term) => resolveTermKey(term.en) === key);
      if (match) push(match);
    }
  }
  return output;
}

export interface ResolvedPreset {
  preset: VocabularyPreset;
  terms: PromptVocabularySearchItem[];
  /** Tags found in the local library, before the minimum threshold. */
  hits: number;
  total: number;
}

/** Resolve presets against exact rows; unresolved tags are dropped, not faked. */
export function resolvePresets(
  presets: readonly VocabularyPreset[],
  resolved: readonly PromptVocabularySearchItem[],
): ResolvedPreset[] {
  const byKey = new Map<string, PromptVocabularySearchItem>();
  for (const term of resolved) {
    const key = resolveTermKey(term.en);
    if (!byKey.has(key)) byKey.set(key, term);
  }
  const output: ResolvedPreset[] = [];
  for (const preset of presets) {
    const terms: PromptVocabularySearchItem[] = [];
    const seen = new Set<string>();
    for (const wanted of preset.terms) {
      const key = resolveTermKey(wanted);
      if (seen.has(key)) continue;
      const term = byKey.get(key);
      if (!term) continue;
      seen.add(key);
      terms.push(term);
    }
    if (terms.length < MIN_PRESET_TERMS) continue;
    output.push({ preset, terms, hits: terms.length, total: preset.terms.length });
  }
  return output;
}