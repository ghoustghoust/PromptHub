import type {
  PromptCreativityLayer,
  PromptEntityResolution,
  PromptModelDirective,
  PromptOrchestrationField,
  PromptOrchestrationInput,
  PromptOrchestrationMode,
  PromptMossLayoutResult,
  PromptSelectedTerm,
} from "@prompthub/shared/types";
import { isVideoOrchestrationMode } from "@prompthub/shared/types";
import { buildReferenceStyleText } from "@prompthub/shared/utils/prompt-reference";
import { getPromptRuleCard } from "./prompt-orchestrator-rule-cards";
import { compileMossLayout, serializeMossLayout } from "./prompt-moss-layout";

export interface PromptCompositionMessages {
  system: string;
  user: string;
}

export interface PromptComposition {
  initialPrompt: string;
  completePrompt: string;
  fields: PromptOrchestrationField[];
  payload?: unknown;
  /** Refined descriptions in draw order; the host owns all geometry. */
  layoutCaptions?: string[];
  layout?: PromptMossLayoutResult;
}

const MODE_INSTRUCTIONS: Record<PromptOrchestrationMode, string> = {
  expand:
    "Expand the core idea with coherent visual conditions and a restrained number of useful creative suggestions.",
  professional:
    "Act as a professional art director. Use the vocabulary as a reference pool, resolve spatial and material coherence, and do not merely concatenate tags.",
  polish:
    "Polish the source prompt for clarity, specificity, and execution. Preserve its scope and meaning; do not turn polishing into a new concept.",
  reverse:
    "Reconstruct facts from the reference text or images. Distinguish observation from inference and never invent cropped-out or invisible details. For UI screenshots or documents, distinguish embedded textual specifications from visible image evidence: do not treat field counts, ratings, filenames, buttons, or UI labels as picture content, and do not invent a depicted person merely because text describes one. When synthesizing a prompt from embedded text, identify that textual provenance in rationale instead of presenting it as visual observation. Exclude quality scores and booster phrases.",
  edit:
    "Apply the edit instruction to the source prompt. Preserve every unaffected fixed fact and make the requested change explicit.",
  random:
    "Use the selected controlled-random terms only within the locked subject and setting. Keep random choices flexible; never change the locked constraints.",
  json:
    "Produce the normal three-part result and also return a directly consumable JSON payload containing the finalized prompt and structured fields.",
  lora:
    "Legacy adapter-constraint mode: preserve all base-model and LoRA trigger words exactly and respect their weight ranges. Do not perform base-model/LoRA compatibility scoring.",
  "video-text":
    "Write a MiniMax-H3 text-to-video prompt with timed shots, visual action, camera, ambience and music. This authors text only; it does not generate video.",
  "video-frames":
    "Write a MiniMax-H3 first/last-frame video prompt. Preserve supplied frame roles and author the transition, action, camera and lighting between them. Images are optional evidence, never a requirement for drafting.",
  "video-multi-reference":
    "Write a MiniMax-H3 multi-reference prompt using the six-field official structure. Map each user reference to a stable subject and its role; do not claim unprovided image details.",
  "video-long":
    "Write a long-form image-to-video shot plan with continuous subject identity, spatial continuity, escalating action and a timeline that fits the requested duration.",
  "video-short-drama":
    "Write a reusable system prompt for a short-drama prompt-writing agent, not a single video prompt. Include episode/shot structure, character consistency, hooks, timing, dialogue, ambience and music rules without copying a whole fixed template.",
  "video-beat":
    "Experimental, not an official MiniMax-H3 guarantee: align shot changes and action accents to user-supplied beat timestamps. Preserve the beat list exactly and warn that beat-sync output needs user validation.",
};

const H3_THREE_FIELDS = [
  "integrated_multimodal_description:",
  "overall_soundscape:",
  "non_diegetic_music:",
];
const H3_SIX_FIELDS = [
  "subject_definitions:",
  "summary:",
  "retention_analysis:",
  "detailed_description:",
  "overall_soundscape:",
  "non_diegetic_music:",
];

function taskOutputContract(input: PromptOrchestrationInput): string {
  if (input.mode === "video-multi-reference") {
    return `The completePrompt string itself must use the six-field MiniMax-H3 structure and contain these exact labels in order: ${H3_SIX_FIELDS.join(" ")}. A plain sentence or generic video description is invalid.`;
  }
  if (isVideoOrchestrationMode(input.mode) && input.mode !== "video-short-drama") {
    return `The completePrompt string itself must use the MiniMax-H3 structure and contain these exact labels in order: ${H3_THREE_FIELDS.join(" ")}. A plain sentence or generic video description is invalid.`;
  }
  if (input.mode === "video-short-drama") {
    return "The completePrompt must be a multi-section reusable agent system prompt with explicit role, inputs, workflow, continuity, output and validation rules. A single video prompt is invalid.";
  }
  if (input.layout) {
    return `Native MOSS canvas mode: completePrompt must be only the refined overall summary.caption, not JSON. Also return layoutCaptions as an array of exactly ${input.layout.boxes.length} refined visual descriptions in the user's draw order. Do not return coordinates, change box order or labels, or rewrite exact text-box content; PromptHub deterministically compiles the final Layout JSON.`;
  }
  if (input.outputFormat === "layout") {
    return "The completePrompt must be one valid Layout JSON line with summary, items, bbox_coord_space=abs_centralized and bbox_format=yxyx, matching the requested canvas, not prose.";
  }
  return "Follow the selected model and task output format exactly.";
}

const VOCABULARY_STATE_CONTRACT = `
Vocabulary states:
- locked: user requirement; keep the wording exactly, never rephrase, replace or drop it.
- recommended: user requirement; the concept must appear, but you may adjust wording to fit the sentence.
- reference: optional material supplied by the user; reuse, adapt or ignore it per slot. It is never a requirement.
- excludedTermIds: never use these terms, even if they would fit.`.trim();

const ENTITY_CONTRACT = `
Named identities:
- A resolved entity name is a fixed fact taken from the user's input. Keep that exact spelling; never swap in a different character, series or artist.
- A resolved name identifies the subject only. Do not expand it into an assumed appearance, outfit or personality unless the user asked for appearance details.
- An ambiguous mention lists candidate identities. Do not choose one and do not merge their attributes; keep the user's text as written.
- An unresolved name stays verbatim. Never replace it with a similar-looking library entry.`.trim();

const OUTPUT_CONTRACT = `
Return one valid JSON object and nothing else. Do not use Markdown fences.Schema:
{
  "initialPrompt": "concise prompt containing only required core elements",
  "completePrompt": "ready-to-use prompt containing required and inferred elements; include optional suggestions only when the guidance and model rules permit them",
  "fields": [
    {
      "name": "semantic field name",
      "value": "field value",
      "layer": "fixed | flexible | optional",
      "rationale": "optional reason for an inference or suggestion",
      "termId": "optional vocabulary id"
    }
  ],
  "payload": "required only in json mode; any valid JSON value",
  "layoutCaptions": ["required only for native MOSS canvas mode; one refined caption per box"]
}
Layer contract:
- fixed: explicitly requested by the user, including locked terms and model triggers. Never remove or rewrite their meaning.
- flexible: a reasonable derivation needed to realize the intent, including automatic vocabulary selections. Explain the derivation in rationale when useful.
- optional: a creative addition. Every optional field is explicitly a suggestion, not a user requirement.
Automatic relevance/random vocabulary selections are never user-fixed facts; use flexible for their fields.
Do not print layer labels, rationales, warnings, or commentary inside initialPrompt or completePrompt.
`.trim();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(content: string): Record<string, unknown> {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const raw = fenced?.[1] ?? trimmed;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `LLM composition was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isRecord(parsed)) {
    throw new Error("LLM composition JSON must be an object");
  }
  return parsed;
}

function requiredString(
  record: Record<string, unknown>,
  key: string,
): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`LLM composition field ${key} must be a non-empty string`);
  }
  return value.trim();
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error(`LLM composition field ${label} must be a string`);
  }
  return value;
}

function parseLayer(value: unknown): PromptCreativityLayer {
  if (value === "fixed" || value === "flexible" || value === "optional") {
    return value;
  }
  throw new Error("LLM composition field layer must be fixed, flexible, or optional");
}

function parseField(value: unknown, index: number): PromptOrchestrationField {
  if (!isRecord(value)) {
    throw new Error(`LLM composition fields[${index}] must be an object`);
  }
  const requestedLayer = parseLayer(value.layer);
  const termId = optionalString(value.termId, `fields[${index}].termId`);
  // Only the system can promote a fact to fixed: it does so from user input or
  // an explicit term id. An LLM field without a vocabulary link is a derivation.
  const layer = requestedLayer === "fixed" && termId === undefined ? "flexible" : requestedLayer;
  const field: PromptOrchestrationField = {
    name: requiredString(value, "name"),
    value: requiredString(value, "value"),
    layer,
    source: "llm",
  };
  const rationale = optionalString(value.rationale, `fields[${index}].rationale`);
  const notes = [
    rationale,
    layer !== requestedLayer
      ? "Downgraded from fixed: an LLM field needs a vocabulary termId to be a fixed fact."
      : undefined,
  ].filter((note): note is string => typeof note === "string" && note.length > 0);
  if (notes.length > 0) field.rationale = notes.join(" ");
  if (termId !== undefined) field.termId = termId;
  return field;
}

function parseLayoutCaptions(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 32) {
    throw new Error("LLM composition layoutCaptions must be an array of at most 32 items");
  }
  return value.map((caption, index) => {
    if (typeof caption !== "string" || !caption.trim()) {
      throw new Error(`LLM composition layoutCaptions[${index}] must be a non-empty string`);
    }
    return caption.trim();
  });
}

export function parsePromptComposition(
  content: string,
  mode: PromptOrchestrationMode,
  includePayload = false,
): PromptComposition {
  const record = parseJson(content);
  const layoutCaptions = parseLayoutCaptions(record.layoutCaptions);
  if (!Array.isArray(record.fields)) {
    throw new Error("LLM composition fields must be an array");
  }
  if (record.fields.length > 100) {
    throw new Error("LLM composition fields exceed the 100-field limit");
  }
  if ((mode === "json" || includePayload) && !("payload" in record)) {
    throw new Error("LLM composition must include payload when structured payload output is requested");
  }
  return {
    initialPrompt: requiredString(record, "initialPrompt"),
    completePrompt: requiredString(record, "completePrompt"),
    fields: record.fields.map(parseField),
    ...(mode === "json" || includePayload ? { payload: record.payload } : {}),
    ...(layoutCaptions ? { layoutCaptions } : {}),
  };
}

export function validateTaskComposition(
  input: PromptOrchestrationInput,
  composition: PromptComposition,
): void {
  const output = composition.completePrompt;
  if (input.mode === "video-multi-reference") {
    const missing = H3_SIX_FIELDS.filter((label) => !output.includes(label));
    if (missing.length > 0) {
      throw new Error(`MiniMax-H3 six-field output is missing: ${missing.join(", ")}`);
    }
    return;
  }
  if (isVideoOrchestrationMode(input.mode) && input.mode !== "video-short-drama") {
    const missing = H3_THREE_FIELDS.filter((label) => !output.includes(label));
    if (missing.length > 0) {
      throw new Error(`MiniMax-H3 output is missing required fields: ${missing.join(", ")}`);
    }
    return;
  }
  if (input.mode === "video-short-drama") {
    if (output.length < 200 || !output.includes("\n")) {
      throw new Error("Short-drama output is not a multi-section agent system prompt");
    }
    return;
  }
  if (input.layout) {
    if (composition.layoutCaptions?.length !== input.layout.boxes.length) {
      throw new Error("MOSS canvas output must contain exactly one refined caption per box");
    }
    return;
  }
  if (input.outputFormat === "layout" && !input.layout) {
    const layout = parseJson(output);
    if (!isRecord(layout.summary) || !Array.isArray(layout.items) ||
        layout.bbox_coord_space !== "abs_centralized" || layout.bbox_format !== "yxyx") {
      throw new Error("Layout output does not match the required summary/items/bbox contract");
    }
  }
}

export function finalizeMossLayoutComposition(
  input: PromptOrchestrationInput,
  composition: PromptComposition,
): PromptComposition {
  if (!input.layout) return composition;
  const initialLayout = compileMossLayout(
    input.layout,
    input.prompt ?? "",
    input.layout.boxes.map((box) => box.caption),
  );
  const completeLayout = compileMossLayout(
    input.layout,
    composition.completePrompt,
    composition.layoutCaptions,
  );
  return {
    initialPrompt: serializeMossLayout(initialLayout),
    completePrompt: serializeMossLayout(completeLayout),
    fields: composition.fields,
    ...(composition.payload !== undefined ? { payload: composition.payload } : {}),
    layout: completeLayout,
  };
}

function referenceStyleSection(input: PromptOrchestrationInput): string {
  return buildReferenceStyleText(input.referenceStyles ?? []);
}

/**
 * The writing layer is the user's layer plus every selected knowledge module,
 * in selection order. Budget checks and the model prompt share this text so
 * the preview and the actual run can never disagree.
 */
export function buildWritingLayerText(input: PromptOrchestrationInput): string {
  const parts: string[] = [];
  const layer = input.systemPromptLayer?.trim();
  if (layer) parts.push(layer);
  for (const module of input.knowledgeModules ?? []) {
    const content = module.content?.trim();
    if (!content) continue;
    const origin = [module.packName?.trim(), module.packId?.trim()].find(Boolean);
    const meta = [origin ? `pack: ${origin}` : "", `layer: ${module.layer ?? "H"}`]
      .filter(Boolean)
      .join("; ");
    parts.push(`[Knowledge module: ${module.title.trim()} (${meta})]\n${content}`);
  }
  return parts.join("\n\n");
}

function systemPromptLayerSection(input: PromptOrchestrationInput): string {
  const layer = buildWritingLayerText(input);
  if (!layer) return "";
  const origin = input.systemPromptLayerSource?.trim();
  const hasModules = (input.knowledgeModules?.length ?? 0) > 0;
  return [
    origin
      ? `Additional system layer selected from the user's prompt library ("${origin}").`
      : "Additional system layer written by the user.",
    "Treat it as a standing requirement about style, camera language, or action beats. Apply it to the generated prompt, but never copy it verbatim as its own sentence and never let it override the rule card, the fixed facts, or the scene the user already described.",
    hasModules
      ? "The bracketed knowledge modules below are imported methodology. Follow their methods where they fit, but never cite module titles, pack names or ids, and never paste their headings into the generated prompt."
      : "",
    layer,
  ].filter(Boolean).join("\n");
}

export function buildCompositionMessages(
  input: PromptOrchestrationInput,
  selectedTerms: PromptSelectedTerm[],
  modelDirectives: PromptModelDirective[],
  entities: PromptEntityResolution[] = [],
): PromptCompositionMessages {
  const mode = input.mode ?? "expand";
  const system = [
    "You are PromptHub's knowledge-driven visual prompt orchestrator.",
    MODE_INSTRUCTIONS[mode],
    getPromptRuleCard(input.skill),
    input.guidanceMode === "human-led"
      ? "Human-led mode: the user's searched vocabulary is organized by state. locked terms must be kept verbatim; recommended terms must appear but their wording may be adjusted to fit the sentence; reference terms are optional material that may be reused, adapted or ignored. Preserve the user's structure, make only restrained coherence/polish changes, and do not add automatic vocabulary or unrelated entities. Put any nonessential creative idea only in optional fields, never merge it into the final prompt without user approval."
      : "Agent-led mode: guide the initial idea actively while respecting the selected rule card and the user's fixed facts. Useful creative additions must remain explicitly optional.",
    VOCABULARY_STATE_CONTRACT,
    ENTITY_CONTRACT,
    referenceStyleSection(input),
    systemPromptLayerSection(input),
    OUTPUT_CONTRACT,
    taskOutputContract(input),
  ].join("\n\n");
  const user = JSON.stringify({
    mode,
    intent: input.prompt ?? null,
    fixedDetails: input.fixedDetails ?? [],
    constraints: input.constraints ?? [],
    editInstruction: input.editInstruction ?? null,
    random: input.random ?? null,
    series: input.series ?? null,
    outputFormat: input.outputFormat ?? null,
    canvas: input.canvas ?? null,
    layout: input.layout ?? null,
    referenceImageCount: input.imageUrls?.length ?? 0,
    guidanceMode: input.guidanceMode ?? "agent-led",
    includePayload: input.includePayload === true || mode === "json",
    video: input.video ?? null,
    entities: entities.map((entity) => ({
      text: entity.mention.text,
      signal: entity.mention.signal,
      status: entity.status,
      displayName: entity.displayName ?? null,
      candidates:
        entity.status === "ambiguous"
          ? entity.candidates.map((candidate) => candidate.displayName)
          : [],
    })),
    vocabulary: selectedTerms.filter((term) => term.selectionReason !== "reference"),
    referenceVocabulary: selectedTerms.filter((term) => term.selectionReason === "reference"),
    excludedTermIds: input.excludedTermIds ?? [],
    modelDirectives,
  });
  return { system, user };
}

function selectedTermText(term: PromptSelectedTerm): string {
  return term.template?.trim() || term.en;
}

function dedupeFields(
  fields: PromptOrchestrationField[],
): PromptOrchestrationField[] {
  const seen = new Set<string>();
  return fields.filter((field) => {
    const key = `${field.name}\0${field.value}\0${field.layer}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildFixedFields(
  input: PromptOrchestrationInput,
  selectedTerms: PromptSelectedTerm[],
  modelDirectives: PromptModelDirective[],
): PromptOrchestrationField[] {
  const fields: PromptOrchestrationField[] = [];
  const add = (
    name: string,
    value: string | undefined,
    source: PromptOrchestrationField["source"] = "user",
    termId?: string,
  ) => {
    if (value?.trim()) fields.push({ name, value: value.trim(), layer: "fixed", source, ...(termId ? { termId } : {}) });
  };
  add("sourcePrompt", input.prompt);
  (input.fixedDetails ?? []).forEach((value) => add("fixedDetail", value));
  (input.constraints ?? []).forEach((value) => add("constraint", value));
  add("editInstruction", input.editInstruction);
  add("randomSubject", input.random?.subject);
  add("randomSetting", input.random?.setting);
  add("series", input.series);
  add("outputFormat", input.outputFormat);
  add("guidanceMode", input.guidanceMode);
  add("videoStyle", input.video?.style);
  add("videoAction", input.video?.action);
  add("cameraMotion", input.video?.cameraMotion);
  add("videoLighting", input.video?.lighting);
  add("videoAudio", input.video?.audio);
  add("videoMusic", input.video?.music);
  add("videoDialogue", input.video?.dialogue);
  add("referencePlan", input.video?.referencePlan);
  add("beatTimestamps", input.video?.beatTimestamps);
  add("continuity", input.video?.continuity);
  if (input.video?.durationSeconds !== undefined)
    add("durationSeconds", String(input.video.durationSeconds));
  if (input.video?.shotCount !== undefined)
    add("shotCount", String(input.video.shotCount));
  if (input.canvas) {
    add("canvas", `${input.canvas.width}x${input.canvas.height}`);
  }
  input.layout?.boxes.forEach((box, index) => {
    add(`layoutBox ${index + 1}`, JSON.stringify({
      label: box.label,
      caption: box.caption,
      ...(box.label === "text" ? { text: box.text } : {}),
      ...(box.character === true ? { character: true } : {}),
      normalizedYxyx: box.bbox,
    }));
  });
  selectedTerms
    .filter((term) => term.selectionReason === "explicit")
    .forEach((term) =>
      add(term.category, selectedTermText(term), "vocabulary", term.id),
    );
  modelDirectives.forEach((directive) => {
    directive.triggerWords.forEach((word) =>
      add(`${directive.modelId} trigger`, word, "model-profile"),
    );
  });
  return dedupeFields(fields);
}

function buildSelectedVocabularyFields(
  selectedTerms: PromptSelectedTerm[],
): PromptOrchestrationField[] {
  return selectedTerms
    .filter((term) => term.selectionReason !== "explicit" && term.selectionReason !== "reference")
    .map((term) => ({
      name: term.category,
      value: selectedTermText(term),
      layer: "flexible",
      source: "vocabulary",
      rationale:
        term.selectionReason === "random"
          ? "Controlled-random vocabulary selected within the locked constraints."
          : "Relevance-selected vocabulary used to realize the user intent.",
      termId: term.id,
    }));
}

export function mergeFixedFields(
  composition: PromptComposition,
  fixedFields: PromptOrchestrationField[],
  selectedTerms: PromptSelectedTerm[],
): PromptComposition {
  const selectedIds = new Set(selectedTerms.map((term) => term.id));
  const llmFields = composition.fields.filter(
    (field) => !field.termId || !selectedIds.has(field.termId),
  );
  return {
    ...composition,
    fields: dedupeFields([
      ...fixedFields,
      ...buildSelectedVocabularyFields(selectedTerms),
      ...llmFields,
    ]),
  };
}

function buildVideoFallback(
  input: PromptOrchestrationInput,
  initialPrompt: string,
): string {
  const mode = input.mode ?? "video-text";
  const action = input.video?.action?.trim() || input.prompt?.trim() || initialPrompt;
  if (mode === "video-short-drama") {
    return `You are a short-drama prompt-writing agent. Preserve the user's series concept, recurring character definitions, episode hooks, shot timing, exact dialogue, ambience and music decisions. Validate every cut against the requested duration and never copy a fixed episode template blindly.\n\nUser concept: ${action}`;
  }
  const soundscape = input.video?.audio?.trim() || "N/A";
  const music = input.video?.music?.trim() || "N/A";
  if (mode === "video-multi-reference") {
    return `subject_definitions:\n${input.video?.referencePlan?.trim() || "Define each supplied reference once by its user-provided role."}\n\nsummary:\n${action}\n\nretention_analysis:\nPreserve user-locked identities and frame roles; unprovided visual details remain unverified.\n\ndetailed_description:\n[Shot 1] ${action}\n\noverall_soundscape:\n${soundscape}\n\nnon_diegetic_music:\n${music}`;
  }
  const alignment = mode === "video-frames"
    ? "Picture 1 is the first frame and Picture 2 is the last frame when those references are supplied; unprovided frame details are inferred from the user's text.\n\n"
    : "";
  return `${alignment}integrated_multimodal_description: [Shot 1] ${action}\n\noverall_soundscape:\n${soundscape}\n\nnon_diegetic_music:\n${music}`;
}

export function buildFallbackComposition(
  input: PromptOrchestrationInput,
  selectedTerms: PromptSelectedTerm[],
  modelDirectives: PromptModelDirective[],
): PromptComposition {
  const fixedFields = buildFixedFields(input, selectedTerms, modelDirectives);
  const suggestions = selectedTerms.filter(
    (term) => term.selectionReason !== "explicit" && term.selectionReason !== "reference",
  );
  const initialPrompt = [...new Set(fixedFields.map((field) => field.value))].join(", ");
  const completePrompt = isVideoOrchestrationMode(input.mode)
    ? buildVideoFallback(input, initialPrompt)
    : [
        initialPrompt,
        ...suggestions.map(selectedTermText),
      ]
        .filter(Boolean)
        .join(", ");
  const suggestionFields: PromptOrchestrationField[] = suggestions.map((term) => ({
    name: term.category,
    value: selectedTermText(term),
    layer: "optional",
    source: "vocabulary",
    rationale: "Vocabulary suggestion retained by the deterministic fallback.",
    termId: term.id,
  }));
  const fields = dedupeFields([...fixedFields, ...suggestionFields]);
  if (input.layout) {
    const layout = compileMossLayout(input.layout, input.prompt ?? "");
    const serialized = serializeMossLayout(layout);
    return { initialPrompt: serialized, completePrompt: serialized, fields, layout };
  }
  return { initialPrompt, completePrompt, fields };
}
