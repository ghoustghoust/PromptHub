/**
 * Script flow: a script is a linear task, not a single prompt.
 *
 * Outline → script → storyboard → generation unit. Each stage owns a version
 * chain so a revision never overwrites the text an earlier downstream step was
 * built from; downstream stages whose `basedOn` is older than the current
 * upstream version are reported as stale instead of being silently reused.
 */

export type PromptScriptStage = "outline" | "script" | "storyboard" | "unit";

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

export interface PromptScriptVersion {
  /** 1-based, monotonic per stage. */
  version: number;
  text: string;
  createdAt: string;
  /** Upstream stage version this text was written against. */
  basedOn?: Partial<Record<PromptScriptStage, number>>;
}

export interface PromptScriptFlow {
  /** Insertion order is the linear order; old versions stay in place. */
  versions: Record<PromptScriptStage, PromptScriptVersion[]>;
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
  const version: PromptScriptVersion = {
    version: (list[list.length - 1]?.version ?? 0) + 1,
    text,
    createdAt: (input.now ?? new Date()).toISOString(),
    ...(Object.keys(basedOn).length > 0 ? { basedOn } : {}),
  };
  return {
    flow: {
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