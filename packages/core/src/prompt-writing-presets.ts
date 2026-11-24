import type { BuiltinPromptWritingPresetSeed } from "@prompthub/db";

/**
 * Shipped writing presets. They are authored here, not copied from the
 * third-party guides under prompt/ (that directory is gitignored and its
 * originals are imported locally by the user). Each entry only covers "how to
 * write, how much, which dimensions, from which angle"; output contracts stay
 * in the rule cards.
 *
 * Validation status is honest: none of these has been through a controlled
 * image comparison yet, so all ship as "unverified".
 */
export const BUILTIN_PROMPT_WRITING_PRESETS: BuiltinPromptWritingPresetSeed[] = [
  {
    id: "builtin-moss-writing-core",
    name: "MOSS 写作核心（压缩）",
    targetSkill: "moss",
    methodology: "writing-guide",
    sourceFile: "moodyMossPromptWriting_v40.txt",
    description:
      "从 MOSS 写作规范提炼的正文写法：优先级、场景推理、Caption 结构、人物动作精度与密度控制。不含 Layout 坐标规则。",
    validationStatus: "unverified",
    compressedContent: `## Priorities and fixed facts
- Treat the user's subject count, identities, relationships, actions, style, setting, visible text and exclusions as fixed. Never trade them for a more attractive idea.
- Separate what the user fixed, what is flexible but needed for a convincing image, and optional decoration. Fill the flexible parts coherently; drop decoration unless it earns its place.
- If the request is thin, expand only where the scene stays plausible. Do not invent a second storyline, extra characters or a prop inventory.

## Scene reasoning before writing
- Identify medium and genre, camera position, framing, the main action, the location and the light before writing a sentence.
- Block the scene in depth: foreground, middle ground, background, gaze direction, and contact between bodies and objects.
- Check visibility: every action you describe must be inside the chosen crop, and hands must be able to reach what they hold.
- Keep one moment and one composition. A short high-signal prompt beats a long one that dilutes the subject.

## Caption architecture
- Paragraph one: the kind of image and the camera's relationship to the scene, plus the prevailing light.
- Paragraph two: the lead subject's position in frame, visible identity, clothing with material and colour, posture, face direction and expression.
- Later paragraphs: each additional subject that matters gets its own space and a clear role, so hands and actions never blur together.
- Final paragraph: environment and background after the subjects are established, then light, depth layers, texture and composition.
- This is a flexible guide, not a fill-in template. A single portrait does not need four paragraphs.

## Character and action precision
- Order people by importance to the image and place each one relative to the camera, the others and relevant objects.
- Bind every attribute to its owner. Never let two characters share one pool of hair, clothing or gesture descriptions.
- Name the hand that holds, opens, touches or reaches, and make the contact believable.
- Describe emotion through visible features and body language, not inner thoughts or backstory.
- Do not describe hidden limbs, feet or full-body stance in a tight crop.

## Density and authenticity
- Prefer concrete surfaces, worn materials, ordinary traces and location-specific cues over stock-image perfection.
- Avoid empty praise, quality boosters, repeated tags, and vague verbs such as "interacting" without a visible action.
- Vary openings, camera distances and shot setups between outputs; do not default to the same cafe, golden hour or waist-up framing.
- Use the language of the requested medium instead of forcing photorealism onto an illustration.
- Never add generation settings, negative prompt lists, analysis or commentary to the prompt body.`,
  },
  {
    id: "builtin-k2-design-cards",
    name: "K2 壁纸设计卡流程",
    targetSkill: "k2",
    methodology: "unit-template",
    sourceFile: "K2二次元壁纸设计模板.md",
    description:
      "先做两张五行设计卡再动笔：表达、证据、全幅、识别锚点、风险；用于壁纸与平面视觉的构图决策，不改变 K2 输出契约。",
    validationStatus: "unverified",
    compressedContent: `## Design goals
- Deliver one complete, executable prompt even when the user gives only a few element words.
- Keep the user's subject, count, identity, action, props, clothing, colour ownership, text, aspect and exclusions fixed; supplement only what is unspecified.
- Aim for a coherent theme: mood, imagery and visual language should agree instead of piling up attractive elements.
- Judge the result as a finished wallpaper or graphic design, not a generic scene illustration.

## Two short design cards
- Before writing English, draft two genuinely different cards. Each card has five one-line decisions:
- Expression: the single feeling the viewer should get first.
- Evidence: two concrete visible choices that produce that feeling, and how they connect.
- Full frame: main shape, subject position and scale, viewing path, balance and crop.
- Identity anchors: which visible features make each key element recognisable.
- Risk: what would collapse this card into cliché, clutter or unreadable structure.
- Compare the two cards and pick one; keep the comparison private and do not print the reasoning.

## Compose the frame
- Build from the main shape outward: subject placement and scale, then the viewing path, then supporting elements.
- Decide what the frame edges cut and what stays whole; cropping is a design decision, not an accident.
- Keep colour ownership explicit: one dominant palette or temperature, with accents tied to specific objects.
- Make every symbol carry a visible body: flames need tongues, instruments need readable parts, blades need edge and guard.

## Write and self-check
- Write natural English prose or a coherent phrase list, one style and one medium, without weight syntax, BREAK syntax or quality boosters.
- Bind attributes to their owner and remove mutually exclusive states.
- Verify counts, left/right placement, contact and gaze; verify that the described light explains the visible shading.
- Keep exact on-image text in quotes with its carrier and position; invent no copy, signature or watermark.
- Stop when the design reads clearly. Do not pad to a word count.`,
  },
  {
    id: "builtin-k2-engine-method",
    name: "K2 提示词引擎方法（压缩）",
    targetSkill: "k2",
    methodology: "writing-guide",
    sourceFile: "K2二次元提示词引擎-SFW版-B站-是古手梨花sama.md",
    description:
      "从 K2 引擎规范提炼的输出协议、语义顺序、补全强度与画面文字规则；案例库与字段表不注入。",
    validationStatus: "unverified",
    compressedContent: `## Output protocol
- Default to one English natural-language prompt with no title, explanation, Markdown, JSON or self-check report.
- Use complete sentences; internal tag atoms must be bound, merged and rewritten before they reach the page.
- Do not use weight syntax, character placeholders or BREAK segments unless the user's workflow explicitly requires them.
- Delete quality boosters such as masterpiece or 8k and put the quality into line, material, light, space or object detail.
- Describe one moment and one image unless the user asks for panels, comics or a character sheet.

## Semantic order
- When the user specifies a style: the style segment goes first as one continuous opening block, then subject and identity, visible anchors, clothing and props, action and relationships, setting, time and light, camera and composition.
- When no style is specified: omit the style segment entirely instead of inventing one.
- Beyond the style position this is not a fixed sentence order; keep dependent information adjacent.
- Character A's hair, clothing and action stay together. Never let character B's attributes leak into a shared pool.

## Completion strength
- Short exploratory requests: add only what makes the subject and frame readable.
- Detailed requests: focus on ownership, conflict removal and natural English instead of adding more.
- High-creativity requests: leave colour, lens and background open.
- Reproduction-oriented requests: use a stable identity sentence, three to five colour anchors, a defined lens and visible light.

## Language and visible text
- Default to English for consistency with the vocabulary and official examples; switch to natural Chinese only when the user asks for it.
- Keep on-image text exactly as given, untranslated, written as the exact text "..." with position, hierarchy and carrier.
- Invent no dialogue, signage or watermark when the user supplied no copy.
- Keep aspect ratio, seed, creativity and reference strength as parameter suggestions rather than prompt body text.`,
  },
  {
    id: "builtin-reverse-annotation-safe",
    name: "反推写作规范（全年龄精简）",
    targetSkill: "any",
    methodology: "reverse-guide",
    sourceFile: "反推一.txt / 反推二.txt",
    description:
      "只保留反推的结构性写法：可见证据、空间与动作、排除项、输出顺序。原文档中的露骨描写条款不纳入预设库。",
    validationStatus: "unverified",
    compressedContent: `## What to extract
- Read the image as evidence, not as a story: medium and genre, subject count, visible identity, clothing and materials, props and their contact, setting, time, weather, light and colour.
- Describe only what is visible. Do not guess a name, a backstory, an age or a hidden body part.
- Keep exact visible text as quoted text with its carrier and position.

## Space and action
- Establish the camera first: viewpoint, shot size, angle and crop, then the subject's place in the frame and in depth.
- Give each person their own action, hand assignment, gaze direction and micro-expression; never merge two people's gestures.
- State physical contact by body part, and non-contact interaction by sight line and weight shift.
- Keep the described action inside the crop; a tight portrait cannot show stance or feet.

## What to leave out
- Do not describe art style, artist names, brushwork or rendering engine; describe the visible result instead.
- Ignore watermarks, signatures, interface chrome and mosaic bars.
- Do not describe generation settings, quality tags or camera metadata the image does not show.
- Keep the description all-ages and non-sexualised. When the source is suggestive, report only neutral visible content and say so briefly.

## Output shape
- Write flowing English sentences, not a tag list, in a stable order: subject and appearance, clothing, action and interaction, setting, light and colour, framing.
- Group by subject so each person's attributes stay together.
- No preamble, labels or commentary; return only the description.`,
  },
  {
    id: "builtin-official-guides-checklist",
    name: "官方规范速览（格式/标签/负面词）",
    targetSkill: "any",
    methodology: "official-guide",
    sourceFile: "moss / krea2 / minimaxh3 官方生图规范.htm",
    description:
      "三家官方规范中稳定一致的格式、标签顺序、画师写法与负面词分工。规则卡更严格时以规则卡为准。",
    validationStatus: "unverified",
    compressedContent: `## Output format discipline
- Caption is coherent prose ready to paste; Tags is comma-separated tag syntax; Layout is a compact model-facing JSON that follows the rule card's contract.
- Choose one format per run and never mix coordinates into Caption.
- Quote exact on-image text in its original language and never emit placeholder copy.

## Tag and artist rules
- When Tags is selected for anime work, keep the order quality, score, meta, year, character, series, artist, then general tags.
- Write artist names without the @ prefix; @ is a site convention, not model syntax.
- Do not force tags onto photographic or painterly requests; use the language of that medium.

## Negative prompts and parameters
- Keep exclusions in a separate negative-prompt field when the downstream model supports one; never append a negative list to the positive prompt.
- Keep steps, CFG, sampler, seed, aspect ratio and reference strength out of the prompt body and offer them as separate settings.
- Do not add menus, self-check sections, analysis or reference-image commentary to the prompt.

## Brand and version neutrality
- These notes cover behaviour shared by the MOSS, Krea 2 and MiniMax-H3 guides; when a rule card is stricter, the rule card wins.
- Do not claim one model's parameter is universal or copy another model's syntax into this one.`,
  },
];
