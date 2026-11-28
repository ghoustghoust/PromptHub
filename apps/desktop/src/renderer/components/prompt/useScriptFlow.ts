import { useCallback, useEffect, useRef, useState } from "react";
import {
  createScriptFlow,
  nextScriptStage,
  recordScriptStep,
  type PromptScriptFlow,
  type PromptScriptStage,
} from "@prompthub/core/prompt-script-flow";
import { stageVersions } from "./script-flow-view";

export interface ScriptFlowState {
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
 * the workbench prompt keeps being edited for the current step.
 */
export function useScriptFlow(loadPrompt: (text: string) => void): ScriptFlowState {
  const [flow, setFlow] = useState<PromptScriptFlow | null>(null);
  const [stage, setStage] = useState<PromptScriptStage>("outline");
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    let active = true;
    void window.api.promptOrchestrator
      .getScriptFlow()
      .then((reply) => {
        if (!active || reply.ok !== true) return;
        setFlow(reply.data);
        if (reply.data) setStage(nextScriptStage(reply.data) ?? "outline");
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      active = false;
    };
  }, []);

  const saveVersion = useCallback(async () => {
    setError("");
    try {
      const current = flow ?? createScriptFlow();
      const result = recordScriptStep(current, { stage, text: draft });
      setSaving(true);
      const reply = await window.api.promptOrchestrator.saveScriptFlow(result.flow);
      if (reply.ok !== true) {
        setError(reply.error.message);
        return;
      }
      setFlow(reply.data);
      setDraft("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }, [draft, flow, stage]);

  const loadVersion = useCallback(
    (text: string) => {
      loadPrompt(text);
    },
    [loadPrompt],
  );

  return {
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