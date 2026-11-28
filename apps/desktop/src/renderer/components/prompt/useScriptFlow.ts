import { useCallback, useEffect, useRef, useState } from "react";
import {
  createScriptFlow,
  createUnitMaterials,
  missingUnitMaterialSlots,
  nextScriptStage,
  normalizeScriptShotCount,
  recordScriptStep,
  scriptFlowMaterials,
  scriptFlowShotCount,
  setScriptFlowMaterials,
  setScriptFlowShotCount,
  type PromptScriptFlow,
  type PromptScriptStage,
  type PromptUnitMaterialKind,
  type PromptUnitMaterialMode,
  type PromptUnitMaterials,
} from "@prompthub/core/prompt-script-flow";
import { stageVersions } from "./script-flow-view";

/** Shot count edits are debounced so holding an arrow key does not write per step. */
const SHOT_COUNT_PERSIST_MS = 400;

export interface ScriptFlowState {
  /** Upstream material for this run: the selected version or typed text. */
  stepContext: string;
  setStepContext: (text: string) => void;
  /** Shots the storyboard stage must produce for this scene. */
  shotCount: number;
  setShotCount: (count: number) => void;
  /** Material branch the generation unit is planned for, plus its slot state. */
  materials: PromptUnitMaterials;
  missingMaterialCount: number;
  setMaterialMode: (mode: PromptUnitMaterialMode) => void;
  setReferenceCount: (count: number) => void;
  fillMaterialSlot: (kind: PromptUnitMaterialKind, index?: number) => Promise<void>;
  clearMaterialSlot: (kind: PromptUnitMaterialKind, index?: number) => void;
  flow: PromptScriptFlow | null;
  stage: PromptScriptStage;
  draft: string;
  versions: Array<{ version: number; text: string }>;
  saving: boolean;
  error: string;
  setStage: (stage: PromptScriptStage) => void;
  setDraft: (text: string) => void;
  saveVersion: () => Promise<void>;
  loadVersion: (text: string) => void;
}

/**
 * Script stages are stored on their own: a saved version stays available while
 * the workbench prompt keeps being edited for the current step. The scene shot
 * count is a flow setting, so it comes back with the flow after a reload.
 */
export function useScriptFlow(): ScriptFlowState {
  const [flow, setFlow] = useState<PromptScriptFlow | null>(null);
  const [stage, setStage] = useState<PromptScriptStage>("outline");
  const [draft, setDraft] = useState("");
  const [stepContext, setStepContext] = useState("");
  const [shotCount, setShotCountState] = useState(scriptFlowShotCount(null));
  const [materials, setMaterialsState] = useState<PromptUnitMaterials>(scriptFlowMaterials(null));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const loaded = useRef(false);
  /** Latest flow, so a debounced write never resurrects an older one. */
  const flowRef = useRef<PromptScriptFlow | null>(null);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyFlow = useCallback((next: PromptScriptFlow) => {
    flowRef.current = next;
    setFlow(next);
  }, []);

  const persistSoon = useCallback((next: PromptScriptFlow) => {
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      persistTimer.current = null;
      void window.api.promptOrchestrator
        .saveScriptFlow(next)
        .then((reply) => {
          if (reply.ok !== true) setError(reply.error.message);
        })
        .catch((cause: unknown) => {
          setError(cause instanceof Error ? cause.message : String(cause));
        });
    }, SHOT_COUNT_PERSIST_MS);
  }, []);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    let active = true;
    void window.api.promptOrchestrator
      .getScriptFlow()
      .then((reply) => {
        if (!active || reply.ok !== true) return;
        flowRef.current = reply.data;
        setFlow(reply.data);
        if (reply.data) {
          setShotCountState(scriptFlowShotCount(reply.data));
          setMaterialsState(scriptFlowMaterials(reply.data));
          setStage(nextScriptStage(reply.data) ?? "outline");
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(
    () => () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
    },
    [],
  );

  const setShotCount = useCallback(
    (count: number) => {
      const next = normalizeScriptShotCount(count);
      setShotCountState(next);
      const updated = setScriptFlowShotCount(flowRef.current ?? createScriptFlow(), next);
      applyFlow(updated);
      persistSoon(updated);
    },
    [applyFlow, persistSoon],
  );

  /** Writes the material branch and slot state, keeping versions intact. */
  const applyMaterials = useCallback(
    (next: PromptUnitMaterials) => {
      setMaterialsState(next);
      const updated = setScriptFlowMaterials(flowRef.current ?? createScriptFlow(), next);
      applyFlow(updated);
      persistSoon(updated);
    },
    [applyFlow, persistSoon],
  );

  const setMaterialMode = useCallback(
    (mode: PromptUnitMaterialMode) => {
      applyMaterials(createUnitMaterials(mode, materials.referenceCount));
    },
    [applyMaterials, materials.referenceCount],
  );

  const setReferenceCount = useCallback(
    (count: number) => {
      const next = createUnitMaterials("references", count);
      // Rebuilding the slots must not drop images the user already added.
      const previous = materials.slots;
      applyMaterials({
        ...next,
        slots: next.slots.map(
          (slot) =>
            previous.find(
              (item) =>
                item.kind === "reference" && item.index === slot.index && item.fileName,
            ) ?? slot,
        ),
      });
    },
    [applyMaterials, materials.slots],
  );

  const updateSlot = useCallback(
    (
      kind: PromptUnitMaterialKind,
      index: number | undefined,
      patch: { fileName?: string; label?: string },
    ) => {
      applyMaterials({
        ...materials,
        slots: materials.slots.map((slot) =>
          slot.kind === kind && slot.index === index ? { ...slot, ...patch } : slot,
        ),
      });
    },
    [applyMaterials, materials],
  );

  const fillMaterialSlot = useCallback(
    async (kind: PromptUnitMaterialKind, index?: number) => {
      setError("");
      const paths = await window.electron?.selectImage?.();
      const path = paths?.[0];
      if (!path) return;
      const saved = await window.electron?.saveImage?.([path]);
      const fileName = saved?.[0];
      if (!fileName) {
        setError("The image could not be stored");
        return;
      }
      const label = path.split(/[\\/]/).pop() ?? fileName;
      updateSlot(kind, index, { fileName, label });
    },
    [updateSlot],
  );

  const clearMaterialSlot = useCallback(
    (kind: PromptUnitMaterialKind, index?: number) => {
      updateSlot(kind, index, { fileName: undefined, label: undefined });
    },
    [updateSlot],
  );

  const saveVersion = useCallback(async () => {
    setError("");
    // A pending shot-count write would duplicate this one; the saved flow
    // already carries the current setting.
    if (persistTimer.current) {
      clearTimeout(persistTimer.current);
      persistTimer.current = null;
    }
    try {
      const current = flowRef.current ?? createScriptFlow();
      const result = recordScriptStep(current, { stage, text: draft });
      setSaving(true);
      const reply = await window.api.promptOrchestrator.saveScriptFlow(result.flow);
      if (reply.ok !== true) {
        setError(reply.error.message);
        return;
      }
      applyFlow(reply.data);
      setShotCountState(scriptFlowShotCount(reply.data));
      setMaterialsState(scriptFlowMaterials(reply.data));
      setDraft("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }, [applyFlow, draft, stage]);

  const loadVersion = useCallback((text: string) => {
    // A stage version is context for the next run, not a new instruction.
    setStepContext(text);
  }, []);

  return {
    stepContext,
    setStepContext,
    shotCount,
    setShotCount,
    materials,
    missingMaterialCount: missingUnitMaterialSlots(materials).length,
    setMaterialMode,
    setReferenceCount,
    fillMaterialSlot,
    clearMaterialSlot,
    flow,
    stage,
    draft,
    versions: flow ? stageVersions(flow, stage) : [],
    saving,
    error,
    setStage,
    setDraft,
    saveVersion,
    loadVersion,
  };
}