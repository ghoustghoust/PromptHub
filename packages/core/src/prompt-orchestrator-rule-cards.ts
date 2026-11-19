import type { PromptOrchestrationSkill } from "@prompthub/shared/types";

const MOODY_MOSS_RULE_CARD = [
  "Moody MOSS rule card:",
  "- Preserve requested subjects, counts, identities, relationships, actions, style, setting, visible text, and exclusions.",
  "- Prefer concrete visible detail and coherent physical, camera, spatial, clothing, material, and lighting relationships.",
  "- Caption is the default. Use Layout only for an explicit Layout request or genuine exact-placement requirements.",
  "- Caption is ready-to-paste natural-language prose without coordinates. Layout is compact model-facing JSON without Markdown.",
  "- Keep actions visible within the crop. Do not describe hidden limbs or assign one subject's action to another.",
  "- Use medium-appropriate language; do not force photorealism, cinematic lighting, or a fixed paragraph count.",
  "- Avoid empty praise, quality boosters, redundant tags, stock-image clichés, and arbitrary prop inventories.",
  "- Treat vocabulary as optional reference material, not as a requirement to use every candidate.",
].join("\n");

// Source: prompt/moss官方生图规范.htm plus the user's explicitly labeled token benchmarks.
const MOSS_RULE_CARD = [
  "MOSS-Image native rule card (official guide distilled):",
  "- MOSS is designed for long, detailed prompts. Describe subject/action, setting, camera/framing, medium, lighting, material and palette in plain English sentences.",
  "- The selected outputFormat is locked. Caption is coherent prose; Tags is comma-separated anime/tag syntax only when appropriate; Layout is compact model-facing JSON for exact placement.",
  "- Do not force tags for every image. For anime Tags, follow quality/score/meta/year/character/series/artist then general tags; do not prefix artists with @.",
  "- Layout must be one compact valid JSON line using bbox_coord_space=abs_centralized and bbox_format=yxyx, with summary and a flat items array.",
  "- Model-facing Layout boxes are absolute pixels in [top,left,bottom,right] order relative to the canvas center. Canvas dimensions must be positive multiples of 16 and match the intended output.",
  "- The native PromptHub editor stores normalized 0-1000 yxyx boxes in draw order. Its compiler floors minimum edges, ceils maximum edges, and then subtracts half the exact canvas dimensions; never ask the LLM to recalculate those pixels.",
  "- Quote exact visible text in its original language, preserving case, punctuation and intentional line breaks. Never emit placeholder copy.",
  "- Preserve user-specified counts, subjects, text, colors, clothing, poses, framing, camera, medium and exclusions. Prefer observable detail over quality boosters.",
  "- Use negative prompts only as a separate model setting when supported; never append a negative list to the positive Caption.",
  "- Do not place steps, CFG, sampler settings, menus, self-checks, reference-image commentary or generation controls in the prompt body.",
  "MOSS entity-framework expansion rule:",
  "- Expand within the initial scene framework: appearance, expression, hair, face, clothing, posture, hand position, anchored props, spatial relations, lighting, material and composition may be deepened.",
  "- Do not introduce abrupt unrelated people, animals, crowds, vehicles, buildings or new plot events. Ordinary objects that naturally belong to the user's scene are allowed only when they clarify that scene, not as an arbitrary inventory.",
  "- Never pad or truncate to satisfy a metric. The user's empirical token curve is observational soft guidance, not an official requirement or output limit: 50-500 tokens has the steepest learning value, 500-2000 has diminishing returns, about 2000 is preferred, and about 2500 is a plateau. Redundancy is allowed when it serves the scene; always finish complete sentences and complete structures.",
].join("\n");

// Sources: prompt/K2二次元提示词引擎-SFW版-B站-是古手梨花sama.md and prompt/krea2官方生图规范.htm.
const K2_RULE_CARD = [
  "Krea 2 / K2 natural-language rule card:",
  "- Keep the result all-ages, non-sexual, and non-sexualized.",
  "- Write one coherent paragraph or phrase list, not bullets, JSON, headings, weight syntax, BREAK syntax or quality boosters.",
  "- Use exactly one visual style and one medium. If the user explicitly specifies a style, preserve it as one continuous segment at the beginning. If unspecified, omit style/medium wording rather than substituting a library approximation.",
  "- Preserve every original subject, action, count, color, position and medium. Do not add people, animals or objects that were not implied by the initial idea, and do not turn drawing/painting into photography.",
  "- Bind every attribute to its owner. Keep each character's appearance, clothing, position and action adjacent; never create a shared attribute pool.",
  "- Describe pose, interaction and layout with observable scene language. Convert material, light and action atoms into visible effects and remove mutually exclusive states.",
  "- Preserve exact visible text as short exact text \"...\" with its carrier and position; never invent copy or watermarks.",
  "- Use one moment and one composition. Choose one main shot size, viewpoint and lighting setup with plausible visibility and physical support.",
  "- Adapt length to complexity and polish already-detailed prompts instead of expanding them again. Do not add seed, aspect-ratio, reference-strength or generation-slider parameters.",
  "- Krea 2 is text-to-image and its default negative prompt is ineffective; describe the desired positive state instead of listing exclusions.",
].join("\n");

// Source: prompt/minimaxh3官方生图规范.htm. This is a video guide, not a still-image card.
const MINIMAX_H3_RULE_CARD = [
  "MiniMax-H3 video rule card (official guide distilled):",
  "- Produce video prompt text, never a still-image Caption and never a claim that a video was generated.",
  "- For text/frame video use integrated_multimodal_description, overall_soundscape and non_diegetic_music in that order, with an optional reference-alignment line before them.",
  "- For reference/Character/multi-reference video use subject_definitions, summary, retention_analysis, detailed_description, overall_soundscape and non_diegetic_music.",
  "- Use [Shot 1], [Shot 2] and explicit cut timestamps within the requested duration. Keep the final shot running to the end and match dialogue length to shot duration.",
  "- Describe one camera move per shot as a sentence with amplitude/speed where useful. Preserve first/last-frame roles and reference identities; define every subject label once before use.",
  "- If reference images are absent, write the requested transition from the user's words as an inferred plan, not as a visual observation of frames that were never supplied.",
  "- Put action sounds and diegetic music in the shot description, ambience/physical sounds in overall_soundscape, and score instruments/tempo/dynamics in non_diegetic_music. Use N/A when no score is wanted and never repeat dialogue across sound fields.",
  "- Give each speaking voice a stable (S1), (S2) ID and describe its timbre once. Put only language and exact dialogue inside <d>...</d>; do not translate it.",
  "- Quote short on-screen text exactly, at most one major text element per shot. Do not include emails/social handles, menus or generation instructions.",
  "- Prompt enhancement must remain conceptually disabled: do not append unrequested style, music or entity text.",
].join("\n");

export function getPromptRuleCard(
  skill: PromptOrchestrationSkill | undefined,
): string {
  if (skill === "moss") return MOSS_RULE_CARD;
  if (skill === "k2") return K2_RULE_CARD;
  if (skill === "minimaxH3") return MINIMAX_H3_RULE_CARD;
  return MOODY_MOSS_RULE_CARD;
}
