/**
 * Script flow: a script is a linear task, not a single prompt.
 *
 * Outline → script → storyboard → generation unit. Each stage owns a version
 * chain so a revision never overwrites the text an earlier downstream step was
 * built from; downstream stages whose `basedOn` is older than the current
 * upstream version are reported as stale instead of being silently reused.
 */

import type {
  PromptScriptFlow,
  PromptScriptStage,
  PromptScriptVersion,
  PromptUnitMaterialKind,
  PromptUnitMaterialMode,
  PromptUnitMaterialSlot,
  PromptUnitMaterials,
} from "@prompthub/shared/types";

export type {
  PromptScriptFlow,
  PromptScriptStage,
  PromptScriptVersion,
  PromptUnitMaterialKind,
  PromptUnitMaterialMode,
  PromptUnitMaterialSlot,
  PromptUnitMaterials,
};

/** Shots per scene when the user has not set a number. */
export const DEFAULT_SCRIPT_SHOT_COUNT = 6;
export const MAX_SCRIPT_SHOT_COUNT = 60;

/** Reference images a unit can expect at most, and how many a mode starts with. */
export const MAX_UNIT_REFERENCE_IMAGES = 9;
export const DEFAULT_UNIT_REFERENCE_IMAGES = 3;

export const SCRIPT_STAGE_ORDER: readonly PromptScriptStage[] = [
  "outline",
  "script",
  "storyboard",
  "unit",
];

export type PromptScriptFlowErrorCode =
  | "SCRIPT_STAGE_UNKNOWN"
  | "SCRIPT_STAGE_EMPTY"
  | "SCRIPT_STAGE_OUT_OF_ORDER"
  | "SCRIPT_STAGE_MISSING_DEPENDENCY";

export class PromptScriptFlowError extends Error {
  readonly code: PromptScriptFlowErrorCode;

  constructor(code: PromptScriptFlowErrorCode, message: string) {
    super(message);
    this.name = "PromptScriptFlowError";
    this.code = code;
  }
}

export interface RecordScriptStepInput {
  stage: PromptScriptStage;
  text: string;
  /** Injected for deterministic tests; defaults to now. */
  now?: Date;
}

export interface RecordScriptStepResult {
  flow: PromptScriptFlow;
  version: PromptScriptVersion;
}

export function createScriptFlow(): PromptScriptFlow {
  return {
    versions: { outline: [], script: [], storyboard: [], unit: [] },
  };
}

/**
 * A shot count out of range is clamped to a usable one instead of being
 * written as-is: 0 or 99 would otherwise reach the stage contract verbatim.
 */
export function normalizeScriptShotCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value)) return DEFAULT_SCRIPT_SHOT_COUNT;
  if (value < 1 || value > MAX_SCRIPT_SHOT_COUNT) return DEFAULT_SCRIPT_SHOT_COUNT;
  return value;
}

/** The flow's scene shot count, defaulting when it was never set. */
export function scriptFlowShotCount(flow: PromptScriptFlow | null | undefined): number {
  return normalizeScriptShotCount(flow?.settings?.shotCount);
}

/** Stores the scene shot count on the flow; versions are untouched. */
export function setScriptFlowShotCount(
  flow: PromptScriptFlow,
  count: unknown,
): PromptScriptFlow {
  return {
    ...flow,
    settings: { ...flow.settings, shotCount: normalizeScriptShotCount(count) },
  };
}

function clampReferenceCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value)) return DEFAULT_UNIT_REFERENCE_IMAGES;
  if (value < 1) return 1;
  if (value > MAX_UNIT_REFERENCE_IMAGES) return MAX_UNIT_REFERENCE_IMAGES;
  return value;
}

/**
 * The slots a material mode owes. A unit planned before its frames exist still
 * has the same slots, only without a file, so the missing list is stable.
 */
export function createUnitMaterials(
  mode: PromptUnitMaterialMode,
  referenceCount?: number,
): PromptUnitMaterials {
  if (mode === "first-frame") {
    return { mode, slots: [{ kind: "first-frame" }] };
  }
  if (mode === "first-last") {
    return { mode, slots: [{ kind: "first-frame" }, { kind: "last-frame" }] };
  }
  if (mode === "references") {
    const count = clampReferenceCount(referenceCount);
    return {
      mode,
      referenceCount: count,
      slots: Array.from({ length: count }, (_, index) => ({
        kind: "reference" as const,
        index: index + 1,
      })),
    };
  }
  return { mode: "text", slots: [] };
}

/** A slot file name is a stored name, never a path the renderer supplied. */
function isStoredImageName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 200 &&
    !value.includes("/") &&
    !value.includes("\\") &&
    !value.includes("..")
  );
}

function slotKey(slot: PromptUnitMaterialSlot): string {
  return slot.kind === "reference" ? `reference:${slot.index ?? 0}` : slot.kind;
}

/**
 * Reads stored materials defensively: the slot skeleton always follows the
 * mode, and only a stored file that matches an existing slot is carried over.
 * An unknown mode degrades to text only instead of inventing material needs.
 */
export function normalizeUnitMaterials(value: unknown): PromptUnitMaterials {
  if (!isRecord(value)) return createUnitMaterials("text");
  const mode = value.mode;
  const declared: PromptUnitMaterialMode =
    mode === "first-frame" || mode === "first-last" || mode === "references" ? mode : "text";
  const materials = createUnitMaterials(
    declared,
    typeof value.referenceCount === "number" ? value.referenceCount : undefined,
  );
  if (!Array.isArray(value.slots)) return materials;
  const stored = new Map<string, PromptUnitMaterialSlot>();
  for (const item of value.slots) {
    if (!isRecord(item)) continue;
    if (item.kind !== "first-frame" && item.kind !== "last-frame" && item.kind !== "reference") {
      continue;
    }
    if (!isStoredImageName(item.fileName)) continue;
    const slot: PromptUnitMaterialSlot = {
      kind: item.kind,
      ...(item.kind === "reference" && typeof item.index === "number"
        ? { index: item.index }
        : {}),
      fileName: item.fileName,
      ...(typeof item.label === "string" && item.label.trim()
        ? { label: item.label.trim().slice(0, 200) }
        : {}),
    };
    stored.set(slotKey(slot), slot);
  }
  return {
    ...materials,
    slots: materials.slots.map((slot) => stored.get(slotKey(slot)) ?? slot),
  };
}

/** The flow's material branch, defaulting to text only. */
export function scriptFlowMaterials(flow: PromptScriptFlow | null | undefined): PromptUnitMaterials {
  return normalizeUnitMaterials(flow?.settings?.materials);
}

/** Stores the material branch and slot state on the flow. */
export function setScriptFlowMaterials(
  flow: PromptScriptFlow,
  materials: PromptUnitMaterials,
): PromptScriptFlow {
  return {
    ...flow,
    settings: { ...flow.settings, materials: normalizeUnitMaterials(materials) },
  };
}

/** Slots still waiting for the user, as a short readable list. */
export function missingUnitMaterialSlots(materials: PromptUnitMaterials): PromptUnitMaterialSlot[] {
  return materials.slots.filter((slot) => !slot.fileName);
}

function stageIndex(stage: PromptScriptStage): number {
  const index = SCRIPT_STAGE_ORDER.indexOf(stage);
  if (index < 0) {
    throw new PromptScriptFlowError("SCRIPT_STAGE_UNKNOWN", `Unknown script stage: ${String(stage)}`);
  }
  return index;
}

/** Latest committed version of a stage, or undefined before its first commit. */
export function currentScriptVersion(
  flow: PromptScriptFlow,
  stage: PromptScriptStage,
): PromptScriptVersion | undefined {
  const list = flow.versions[stage];
  return list[list.length - 1];
}

/**
 * Records a new version of `stage`.
 *
 * Linear rule: a stage can only be written after its immediate upstream stage
 * exists. Revising an existing stage is always allowed and appends a version.
 * Skipping ahead (outline → storyboard) is rejected because the skipped stage
 * carries the facts the later one depends on.
 */
export function recordScriptStep(
  flow: PromptScriptFlow,
  input: RecordScriptStepInput,
): RecordScriptStepResult {
  const index = stageIndex(input.stage);
  const text = input.text.trim();
  if (!text) {
    throw new PromptScriptFlowError(
      "SCRIPT_STAGE_EMPTY",
      `Script stage ${input.stage} needs non-empty text`,
    );
  }
  const hasCurrent = currentScriptVersion(flow, input.stage) !== undefined;
  if (!hasCurrent) {
    for (let upstream = 0; upstream < index; upstream += 1) {
      const stage = SCRIPT_STAGE_ORDER[upstream];
      if (!currentScriptVersion(flow, stage)) {
        throw new PromptScriptFlowError(
          "SCRIPT_STAGE_OUT_OF_ORDER",
          `Cannot start ${input.stage} before ${stage} exists`,
        );
      }
    }
  }
  const upstream = index > 0 ? SCRIPT_STAGE_ORDER[index - 1] : undefined;
  if (!upstream) {
    const basedOn: Partial<Record<PromptScriptStage, number>> = {};
    return append(flow, input, text, basedOn);
  }
  const upstreamVersion = currentScriptVersion(flow, upstream);
  if (!upstreamVersion) {
    throw new PromptScriptFlowError(
      "SCRIPT_STAGE_MISSING_DEPENDENCY",
      `Script stage ${input.stage} depends on ${upstream}`,
    );
  }
  return append(flow, input, text, { [upstream]: upstreamVersion.version });
}

function append(
  flow: PromptScriptFlow,
  input: RecordScriptStepInput,
  text: string,
  basedOn: Partial<Record<PromptScriptStage, number>>,
): RecordScriptStepResult {
  const list = flow.versions[input.stage];
  // A unit version remembers which material branch it was planned for, so the
  // dependency is auditable after the slot state changes.
  const materials =
    input.stage === "unit" && flow.settings?.materials
      ? normalizeUnitMaterials(flow.settings.materials)
      : undefined;
  const version: PromptScriptVersion = {
    version: (list[list.length - 1]?.version ?? 0) + 1,
    text,
    createdAt: (input.now ?? new Date()).toISOString(),
    ...(Object.keys(basedOn).length > 0 ? { basedOn } : {}),
    ...(materials ? { materials } : {}),
  };
  return {
    flow: {
      ...flow,
      versions: { ...flow.versions, [input.stage]: [...list, version] },
    },
    version,
  };
}

/**
 * Stages whose stored text was written against an older upstream version.
 * They are still valid history, but must be regenerated before being used as
 * the current step.
 */
export function staleScriptStages(flow: PromptScriptFlow): PromptScriptStage[] {
  const stale: PromptScriptStage[] = [];
  for (let index = 1; index < SCRIPT_STAGE_ORDER.length; index += 1) {
    const stage = SCRIPT_STAGE_ORDER[index];
    const upstream = SCRIPT_STAGE_ORDER[index - 1];
    const own = currentScriptVersion(flow, stage);
    const upstreamVersion = currentScriptVersion(flow, upstream);
    if (!own || !upstreamVersion) continue;
    if (own.basedOn?.[upstream] !== upstreamVersion.version) stale.push(stage);
  }
  return stale;
}

/** The next stage a linear run should write, or null when the flow is complete. */
export function nextScriptStage(flow: PromptScriptFlow): PromptScriptStage | null {
  const stale = new Set(staleScriptStages(flow));
  for (const stage of SCRIPT_STAGE_ORDER) {
    if (!currentScriptVersion(flow, stage) || stale.has(stage)) return stage;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseVersion(value: unknown, stageIndex: number): PromptScriptVersion | null {
  if (!isRecord(value)) return null;
  const version = value.version;
  const text = value.text;
  const createdAt = value.createdAt;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) return null;
  if (typeof text !== "string" || !text.trim()) return null;
  if (typeof createdAt !== "string" || !createdAt.trim()) return null;
  const basedOn: Partial<Record<PromptScriptStage, number>> = {};
  if (isRecord(value.basedOn)) {
    // Only earlier stages can be upstream; anything else is foreign data.
    for (let index = 0; index < stageIndex; index += 1) {
      const upstream = value.basedOn[SCRIPT_STAGE_ORDER[index]];
      if (typeof upstream === "number" && Number.isInteger(upstream) && upstream >= 1) {
        basedOn[SCRIPT_STAGE_ORDER[index]] = upstream;
      }
    }
  }
  return {
    version,
    text,
    createdAt,
    ...(Object.keys(basedOn).length > 0 ? { basedOn } : {}),
    ...(stageIndex === SCRIPT_STAGE_ORDER.indexOf("unit") && isRecord(value.materials)
      ? { materials: normalizeUnitMaterials(value.materials) }
      : {}),
  };
}

/**
 * Reads a stored flow. A malformed version is dropped, not fatal: the rest of
 * the history stays usable, matching how a corrupted workspace row is handled.
 * Only a value that is not a flow object returns null.
 */
export function parseScriptFlow(value: unknown): PromptScriptFlow | null {
  if (!isRecord(value)) return null;
  const versions = value.versions;
  if (!isRecord(versions)) return null;
  const flow = createScriptFlow();
  SCRIPT_STAGE_ORDER.forEach((stage, stageIndex) => {
    const list = versions[stage];
    if (!Array.isArray(list)) return;
    flow.versions[stage] = list
      .map((item) => parseVersion(item, stageIndex))
      .filter((item): item is PromptScriptVersion => item !== null);
  });
  return settingsFrom(value.settings) !== undefined
    ? { ...flow, settings: settingsFrom(value.settings) }
    : flow;
}

/** Stored settings are kept only when they are usable; the default fills in. */
function settingsFrom(
  value: unknown,
): { shotCount?: number; materials?: PromptUnitMaterials } | undefined {
  if (!isRecord(value)) return undefined;
  const settings: { shotCount?: number; materials?: PromptUnitMaterials } = {};
  const shotCount = value.shotCount;
  if (
    typeof shotCount === "number" &&
    Number.isInteger(shotCount) &&
    shotCount >= 1 &&
    shotCount <= MAX_SCRIPT_SHOT_COUNT
  ) {
    settings.shotCount = shotCount;
  }
  if (isRecord(value.materials)) {
    settings.materials = normalizeUnitMaterials(value.materials);
  }
  return Object.keys(settings).length > 0 ? settings : undefined;
}