import { useCallback, useEffect, useRef, useState } from "react";
import {
  createScriptFlow,
  nextScriptStage,
  normalizeScriptShotCount,
  recordScriptStep,
  scriptFlowShotCount,
  setScriptFlowShotCount,
  type PromptScriptFlow,
  type PromptScriptStage,
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
      if (persistTimer.current) clearTimeout(persistTimer.current);
      persistTimer.current = setTimeout(() => {
        persistTimer.current = null;
        void window.api.promptOrchestrator
          .saveScriptFlow(updated)
          .then((reply) => {
            if (reply.ok !== true) setError(reply.error.message);
          })
          .catch((cause: unknown) => {
            setError(cause instanceof Error ? cause.message : String(cause));
          });
      }, SHOT_COUNT_PERSIST_MS);
    },
    [applyFlow],
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