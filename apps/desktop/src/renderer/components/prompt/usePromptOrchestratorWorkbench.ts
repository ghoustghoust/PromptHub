import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  PromptArtistPipeline,
  PromptGuidanceMode,
  PromptKnowledgeContractGroup,
  PromptSharedSemantics,
  PromptKnowledgeImportCommitResult,
  PromptKnowledgeImportPreview,
  PromptKnowledgeModule,
  PromptKnowledgePack,
  PromptMossLayoutBox,
  PromptOrchestrationInput,
  PromptOrchestrationMode,
  PromptOrchestrationOutputFormat,
  PromptOrchestrationResult,
  PromptOrchestrationSkill,
  PromptOrchestratorStreamEvent,
  PromptOrchestratorStreamStage,
  PromptPickerTermState,
  PromptReferenceItem,
  PromptSkillDraft,
  PromptTermDomain,
  PromptVideoOrchestrationInput,
  PromptVocabularySearchItem,
  PromptWritingLayerBudgetPreview,
} from "@prompthub/shared/types";
import { supportsReferenceImages } from "@prompthub/shared/types";
import { estimatePromptTokens } from "@prompthub/shared/utils/prompt-token-estimate";
import { buildReferenceStyleText } from "@prompthub/shared/utils/prompt-reference";
import { resolvePromptTaskContract } from "@prompthub/shared/utils/prompt-task-contract";
import {
  base64ToBlob,
  downscaleImageToDataUrl,
} from "../../utils/image-downscale";
import { findKnowledgeSkillConflict } from "./knowledge-skill-conflict";
import { useSettingsStore } from "../../stores/settings.store";
import { LOCAL_LLAMA_MODEL_ID } from "../../stores/settings/settings-ai-actions";
import { usePromptStore } from "../../stores/prompt.store";
import {
  PREFAB_CATEGORIES,
  defaultModeForSkill,
  defaultOutputFormat,
  isVideoTask,
  referenceImageLimit,
  supportsLayoutDraft,
} from "./prompt-orchestrator-catalog";
import {
  backfillStateFor,
  mergeBackfillTerms,
  shouldBackfillProvenance,
} from "./prompt-backfill";
import { normalizeWorkspaceTerms } from "./prompt-workspace-state";
import {
  EMPTY_WRITING_LAYER,
  type WritingLayerSelection,
} from "./prompt-writing-layer";
import { useMossLayoutEditor } from "./useMossLayoutEditor";
import { applyCaptionsToBoxes } from "./prompt-layout-assist";
import { requestConfirmation } from "../ui/confirmation";

export interface OrchestratorReferenceImage {
  id: string;
  fileName: string;
  dataUrl: string;
}

/** Live view of one run; observational and cleared when the run settles. */
export interface OrchestratorStreamingState {
  runId: string;
  stage: PromptOrchestratorStreamStage;
  round: number;
  text: string;
  fields: string[];
  percent: number;
  mode: "pending" | "stream" | "buffered";
  /** True after the user stopped this run; the partial text is kept for copying. */
  stopped?: boolean;
  firstTokenMs?: number;
  completionTokens?: number;
  tokensPerSecond?: number;
  source?: "provider" | "estimate";
}

const MAX_STREAM_PREVIEW = 40_000;

/** Final observational stats kept after the stream closes, for the result chip. */
export type RunStats = Extract<PromptOrchestratorStreamEvent, { type: "stats" }>;

/** How the user wants a picked term to be treated by the orchestrator. */
export type PrefabTermState = PromptPickerTermState;

export interface PrefabTerm extends PromptVocabularySearchItem {
  state: PrefabTermState;
}

function splitIds(value: string): string[] {
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}

function validCanvas(width: string, height: string): boolean {
  return [Number(width), Number(height)].every(
    (value) => Number.isInteger(value) && value > 0 && value % 16 === 0,
  );
}

export function usePromptOrchestratorWorkbench() {
  const { t } = useTranslation();
  const aiModels = useSettingsStore((state) => state.aiModels);
  const routeDefaults = useSettingsStore((state) => state.modelRouteDefaults);
  const createPrompt = usePromptStore((state) => state.createPrompt);
  const updatePrompt = usePromptStore((state) => state.updatePrompt);
  const libraryPrompts = usePromptStore((state) => state.prompts);
  const getPromptDetail = usePromptStore((state) => state.getPromptDetail);
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<PromptOrchestrationMode>("expand");
  const [skill, setSkill] = useState<PromptOrchestrationSkill>("moodyMoss");
  const [targetPipeline, setTargetPipeline] = useState<PromptArtistPipeline | "">("");
  const [guidanceMode, setGuidanceMode] = useState<PromptGuidanceMode>("agent-led");
  const [outputFormat, setOutputFormat] = useState<PromptOrchestrationOutputFormat>("caption");
  const [includePayload, setIncludePayload] = useState(false);
  const [series, setSeries] = useState("");
  const [domain, setDomain] = useState<"all" | PromptTermDomain>("all");
  const [seriesOptions, setSeriesOptions] = useState<string[]>([]);
  const [llmModelId, setLlmModelId] = useState("");
  const [modelSource, setModelSource] = useState<"cloud" | "local">("cloud");
  const [modelId, setModelId] = useState("");
  const [loraIds, setLoraIds] = useState("");
  const [editInstruction, setEditInstruction] = useState("");
  const [subject, setSubject] = useState("");
  const [setting, setSetting] = useState("");
  const [randomCategories, setRandomCategories] = useState<string[]>([...PREFAB_CATEGORIES]);
  const [seed, setSeed] = useState("");
  const mossLayout = useMossLayoutEditor();
  const [video, setVideo] = useState<PromptVideoOrchestrationInput>({
    durationSeconds: 8,
    shotCount: 1,
  });
  const [referenceImages, setReferenceImages] = useState<OrchestratorReferenceImage[]>([]);
  const [prefabTerms, setPrefabTerms] = useState<PrefabTerm[]>([]);
  const [workspaceHydrated, setWorkspaceHydrated] = useState(false);
  const selectedTermIds = useMemo(
    () => prefabTerms
      .filter((term) => term.state === "locked" || term.state === "recommended")
      .map((term) => term.id),
    [prefabTerms],
  );
  const lockedTermIds = useMemo(
    () => prefabTerms.filter((term) => term.state === "locked").map((term) => term.id),
    [prefabTerms],
  );
  const referenceTermIds = useMemo(
    () => prefabTerms.filter((term) => term.state === "reference").map((term) => term.id),
    [prefabTerms],
  );
  const excludedTermIds = useMemo(
    () => prefabTerms.filter((term) => term.state === "excluded").map((term) => term.id),
    [prefabTerms],
  );
  const [vocabularyTokenBudget, setVocabularyTokenBudget] = useState(900);
  const [rightPanel, setRightPanel] = useState<"result" | "prefab">("result");
  const [result, setResult] = useState<PromptOrchestrationResult | null>(null);
  const [streaming, setStreaming] = useState<OrchestratorStreamingState | null>(null);
  const [canceling, setCanceling] = useState(false);
  const [lastRunStats, setLastRunStats] = useState<RunStats | null>(null);
  const [promptOrigin, setPromptOrigin] = useState<"user" | "result">("user");
  const [systemLayer, setSystemLayer] = useState("");
  const [systemLayerSource, setSystemLayerSource] = useState<string | undefined>();
  const [writingLayer, setWritingLayer] = useState<WritingLayerSelection>(EMPTY_WRITING_LAYER);
  const [knowledgePacks, setKnowledgePacks] = useState<PromptKnowledgePack[]>([]);
  const [knowledgeModulesByPack, setKnowledgeModulesByPack] = useState<
    Record<string, PromptKnowledgeModule[]>
  >({});
  const [knowledgePackIds, setKnowledgePackIds] = useState<string[]>([]);
  const [knowledgeModuleIds, setKnowledgeModuleIds] = useState<string[]>([]);
  const [knowledgeContractGroup, setKnowledgeContractGroup] = useState<
    PromptKnowledgeContractGroup | undefined
  >();
  const [referenceItems, setReferenceItems] = useState<PromptReferenceItem[]>([]);
  const [referenceItemIds, setReferenceItemIds] = useState<string[]>([]);
  /** Content range of the rule card; false keeps the all-ages default. */
  const [allowAdult, setAllowAdult] = useState(false);
  /** Upstream scene facts shared by every target model in this step. */
  const [sharedSemantics, setSharedSemantics] = useState<PromptSharedSemantics>({});
  const [referenceError, setReferenceError] = useState("");
  const [knowledgeError, setKnowledgeError] = useState("");
  const knowledgeLoading = useRef(new Set<string>());
  const [layerContextTokens, setLayerContextTokens] = useState(8192);
  const [layerBudget, setLayerBudget] = useState<PromptWritingLayerBudgetPreview | null>(null);
  const [layerBudgetError, setLayerBudgetError] = useState("");
  const [savedPromptId, setSavedPromptId] = useState<string | null>(null);
  const [isSavingToLibrary, setIsSavingToLibrary] = useState(false);
  const [skillName, setSkillName] = useState("");
  const [skillDraft, setSkillDraft] = useState<PromptSkillDraft | null>(null);
  const [savedSkillId, setSavedSkillId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [isGeneratingSkill, setIsGeneratingSkill] = useState(false);
  const [isSavingSkill, setIsSavingSkill] = useState(false);
  const [isAssistingLayout, setIsAssistingLayout] = useState(false);
  const [assistRunId, setAssistRunId] = useState<string | null>(null);
  const [layoutAssistNote, setLayoutAssistNote] = useState("");
  /** One-step undo for a reverse that replaced a non-empty canvas. */
  const [layoutUndo, setLayoutUndo] = useState<{
    boxes: PromptMossLayoutBox[];
    selectedBoxId: string | null;
  } | null>(null);
  const requestId = useRef(0);
  const skillRequestId = useRef(0);
  const layoutSignature = JSON.stringify({
    width: mossLayout.width,
    height: mossLayout.height,
    boxes: mossLayout.boxes,
  });
  const previousLayoutSignature = useRef(layoutSignature);

  const chatModels = useMemo(
    () => aiModels.filter(
      (model) =>
        (model.type ?? "chat") === "chat" &&
        model.capabilities?.chat !== false &&
        (model.apiProtocol ?? "openai") === "openai",
    ),
    [aiModels],
  );
  const cloudModels = useMemo(
    () => chatModels.filter((model) => model.id !== LOCAL_LLAMA_MODEL_ID),
    [chatModels],
  );
  const localModel = useMemo(
    () => chatModels.find((model) => model.id === LOCAL_LLAMA_MODEL_ID),
    [chatModels],
  );

  useEffect(() => {
    let active = true;
    void window.api.promptOrchestrator.listSeries().then((reply) => {
      if (!active) return;
      if (reply.ok === true) setSeriesOptions(reply.data);
      else setError(reply.error.message);
    });
    return () => {
      active = false;
    };
  }, []);

  // Restore the durable picker and archive once per mount, then persist later
  // edits with a short debounce so typing a model id does not write per key.
  useEffect(() => {
    let active = true;
    void window.api.promptOrchestrator
      .getWorkspaceState()
      .then((reply) => {
        if (!active) return;
        if (reply.ok === true && reply.data) {
          setPrefabTerms(normalizeWorkspaceTerms(reply.data.prefabTerms));
          setModelId(reply.data.modelId ?? "");
          setLoraIds(reply.data.loraIds ?? "");
          if (reply.data.systemLayerText) setSystemLayer(reply.data.systemLayerText);
          setSystemLayerSource(reply.data.systemLayerSource ?? undefined);
          setWritingLayer({
            mode: reply.data.writingPresetId ? "preset" : "custom",
            presetId: reply.data.writingPresetId ?? null,
            variant: reply.data.writingPresetVariant ?? "compressed",
            sectionIds: reply.data.writingPresetSectionIds ?? [],
          });
          if (reply.data.mossLayout) mossLayout.restore(reply.data.mossLayout);
          setKnowledgePackIds(reply.data.knowledgePackIds ?? []);
          setKnowledgeModuleIds(reply.data.knowledgeModuleIds ?? []);
          setKnowledgeContractGroup(reply.data.knowledgeContractGroup);
          setReferenceItemIds(reply.data.referenceItemIds ?? []);
          setAllowAdult(reply.data.allowAdult === true);
          setSharedSemantics(reply.data.sharedSemantics ?? {});
        }
      })
      .catch((cause: unknown) => {
        console.warn("Failed to load orchestrator workspace state", cause);
      })
      .finally(() => {
        if (active) setWorkspaceHydrated(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void window.api.promptKnowledge
      .listPacks()
      .then((reply) => {
        if (!active) return;
        if (reply.ok === true) setKnowledgePacks(reply.data);
        else setKnowledgeError(reply.error.message);
      })
      .catch((cause: unknown) => {
        if (active) setKnowledgeError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void window.api.promptReference
      .list()
      .then((reply) => {
        if (!active) return;
        if (reply.ok === true) setReferenceItems(reply.data);
        else setReferenceError(reply.error.message);
      })
      .catch((cause: unknown) => {
        if (active) setReferenceError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      active = false;
    };
  }, []);

  const selectedReferenceItems = useMemo(() => {
    const byId = new Map(referenceItems.map((item) => [item.id, item]));
    return referenceItemIds
      .map((id) => byId.get(id))
      .filter((item): item is PromptReferenceItem => Boolean(item));
  }, [referenceItemIds, referenceItems]);

  const referenceStyles = useMemo(
    () => selectedReferenceItems.map((item) => ({
      id: item.id,
      nameZh: item.nameZh,
      ...(item.nameEn ? { nameEn: item.nameEn } : {}),
      category: item.category,
      summary: item.summary,
      palette: item.palette,
      ...(item.style && Object.keys(item.style).length > 0 ? { style: item.style } : {}),
    })),
    [selectedReferenceItems],
  );
  const referenceTokens = useMemo(
    () => estimatePromptTokens(buildReferenceStyleText(referenceStyles)),
    [referenceStyles],
  );

  function toggleReferenceItem(id: string): void {
    setReferenceItemIds((current) => {
      if (current.includes(id)) return current.filter((entry) => entry !== id);
      if (current.length >= 3) return current;
      return [...current, id];
    });
  }
  useEffect(() => {
    const missing = knowledgePackIds.filter(
      (id) => !knowledgeModulesByPack[id] && !knowledgeLoading.current.has(id),
    );
    if (missing.length === 0) return;
    let active = true;
    for (const id of missing) {
      knowledgeLoading.current.add(id);
      void window.api.promptKnowledge
        .listModules(id)
        .then((reply) => {
          if (!active) return;
          if (reply.ok === true) {
            setKnowledgeModulesByPack((current) => ({ ...current, [id]: reply.data }));
          } else {
            setKnowledgeError(reply.error.message);
          }
        })
        .catch((cause: unknown) => {
          if (active) setKnowledgeError(cause instanceof Error ? cause.message : String(cause));
        })
        .finally(() => knowledgeLoading.current.delete(id));
    }
    return () => {
      active = false;
    };
  }, [knowledgePackIds, knowledgeModulesByPack]);

  const selectedKnowledgeModules = useMemo(() => {
    const selected = new Map<string, PromptKnowledgeModule & { packName?: string }>();
    for (const packId of knowledgePackIds) {
      const pack = knowledgePacks.find((entry) => entry.id === packId);
      for (const module of knowledgeModulesByPack[packId] ?? []) {
        if (!knowledgeModuleIds.includes(module.id)) continue;
        selected.set(module.id, {
          ...module,
          ...(pack ? { packName: pack.name } : {}),
        });
      }
    }
    return [...selected.values()];
  }, [knowledgePackIds, knowledgePacks, knowledgeModulesByPack, knowledgeModuleIds]);
  const knowledgeTokens = useMemo(
    () => selectedKnowledgeModules.reduce((sum, module) => sum + module.tokens, 0),
    [selectedKnowledgeModules],
  );
  /** Contract modules ship with the selected pack; they cannot be unchecked. */
  const contractModules = useMemo(() => {
    const contracts: Array<PromptKnowledgeModule & { packName?: string }> = [];
    for (const packId of knowledgePackIds) {
      const pack = knowledgePacks.find((entry) => entry.id === packId);
      for (const module of knowledgeModulesByPack[packId] ?? []) {
        if (module.role !== "contract") continue;
        const groups = module.contractGroups ?? [];
        if (
          groups.length > 0 &&
          (!knowledgeContractGroup || !groups.includes(knowledgeContractGroup))
        ) {
          continue;
        }
        contracts.push({
          ...module,
          ...(pack ? { packName: pack.name } : {}),
        });
      }
    }
    return contracts;
  }, [knowledgePackIds, knowledgePacks, knowledgeModulesByPack, knowledgeContractGroup]);
  const hasGroupedContracts = useMemo(
    () => knowledgePackIds.some((packId) =>
      (knowledgeModulesByPack[packId] ?? []).some(
        (module) => module.role === "contract" && (module.contractGroups ?? []).length > 0,
      )),
    [knowledgePackIds, knowledgeModulesByPack],
  );
  const contractTokens = useMemo(
    () => contractModules.reduce((sum, module) => sum + module.tokens, 0),
    [contractModules],
  );
  const knowledgeSkillConflict = useMemo(
    () => findKnowledgeSkillConflict(contractModules),
    [contractModules],
  );
  const activeKnowledgeModules = useMemo(() => {
    const byId = new Map<string, PromptKnowledgeModule & { packName?: string }>();
    for (const module of [...contractModules, ...selectedKnowledgeModules]) {
      if (!byId.has(module.id)) byId.set(module.id, module);
    }
    return [...byId.values()];
  }, [contractModules, selectedKnowledgeModules]);

  function toggleKnowledgePack(id: string): void {
    const selected = knowledgePackIds.includes(id);
    setKnowledgePackIds(selected
      ? knowledgePackIds.filter((entry) => entry !== id)
      : [...knowledgePackIds, id]);
    if (selected) {
      const removed = new Set((knowledgeModulesByPack[id] ?? []).map((module) => module.id));
      if (removed.size > 0) {
        setKnowledgeModuleIds((current) => current.filter((moduleId) => !removed.has(moduleId)));
      }
    }
  }

  function toggleKnowledgeModule(id: string): void {
    setKnowledgeModuleIds((current) => current.includes(id)
      ? current.filter((entry) => entry !== id)
      : [...current, id]);
  }

  /**
   * Writes a previewed pack and refreshes the picker. A re-import replaces the
   * pack at the same source path, so its old id and module selection are dropped.
   */
  async function importKnowledgePack(
    preview: PromptKnowledgeImportPreview,
  ): Promise<PromptKnowledgeImportCommitResult | null> {
    setKnowledgeError("");
    const reply = await window.api.promptKnowledge.commitImport({ preview });
    if (reply.ok !== true) {
      setKnowledgeError(reply.error.message);
      return null;
    }
    const sourcePaths = new Set(preview.packs.map((pack) => pack.sourcePath));
    const replacedIds = new Set(
      knowledgePacks
        .filter((pack) => pack.sourcePath && sourcePaths.has(pack.sourcePath))
        .map((pack) => pack.id),
    );
    const packsReply = await window.api.promptKnowledge.listPacks();
    if (packsReply.ok === true) setKnowledgePacks(packsReply.data);
    else setKnowledgeError(packsReply.error.message);

    setKnowledgePackIds((current) => [
      ...current.filter((id) => !replacedIds.has(id) && !reply.data.packIds.includes(id)),
      ...reply.data.packIds,
    ]);
    if (replacedIds.size > 0) {
      const removedModules = new Set(
        [...replacedIds].flatMap((id) =>
          (knowledgeModulesByPack[id] ?? []).map((module) => module.id)),
      );
      if (removedModules.size > 0) {
        setKnowledgeModuleIds((current) => current.filter((id) => !removedModules.has(id)));
      }
    }
    return reply.data;
  }

  /** Deletes an imported pack after confirmation and clears its selection. */
  async function deleteKnowledgePack(id: string): Promise<void> {
    const pack = knowledgePacks.find((entry) => entry.id === id);
    const confirmed = await requestConfirmation({
      title: t("orchestrator.writingLayer.deletePackTitle"),
      message: t("orchestrator.writingLayer.deletePackMessage", {
        name: pack?.name ?? id,
      }),
      confirmText: t("orchestrator.writingLayer.deletePackConfirm"),
      variant: "destructive",
    });
    if (!confirmed) return;
    const reply = await window.api.promptKnowledge.removePack(id);
    if (reply.ok !== true) {
      setKnowledgeError(reply.error.message);
      return;
    }
    setKnowledgePacks((current) => current.filter((entry) => entry.id !== id));
    setKnowledgePackIds((current) => current.filter((entry) => entry !== id));
    const removedModules = new Set(
      (knowledgeModulesByPack[id] ?? []).map((module) => module.id),
    );
    if (removedModules.size > 0) {
      setKnowledgeModuleIds((current) => current.filter((moduleId) => !removedModules.has(moduleId)));
    }
    setKnowledgeModulesByPack((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  useEffect(() => {
    if (!workspaceHydrated) return;
    const layoutWidth = Number(mossLayout.width);
    const layoutHeight = Number(mossLayout.height);
    const validLayoutCanvas =
      Number.isInteger(layoutWidth) &&
      layoutWidth > 0 &&
      Number.isInteger(layoutHeight) &&
      layoutHeight > 0;
    const timer = window.setTimeout(() => {
      void window.api.promptOrchestrator
        .saveWorkspaceState({
          prefabTerms: prefabTerms.map((term) => ({
            id: term.id,
            category: term.category,
            subcategory: term.subcategory,
            en: term.en,
            zh: term.zh,
            series: term.series,
            template: term.template,
            validationStatus: term.validationStatus,
            state: term.state,
          })),
          modelId,
          loraIds,
          ...(systemLayer.trim() ? { systemLayerText: systemLayer } : {}),
          ...(systemLayerSource ? { systemLayerSource } : {}),
          ...(writingLayer.mode === "preset" && writingLayer.presetId
            ? {
                writingPresetId: writingLayer.presetId,
                writingPresetVariant: writingLayer.variant,
                writingPresetSectionIds: writingLayer.sectionIds,
              }
            : { writingPresetId: null }),
          ...(validLayoutCanvas
            ? {
                mossLayout: {
                  version: 1 as const,
                  canvas: { width: layoutWidth, height: layoutHeight },
                  boxes: mossLayout.boxes,
                },
              }
            : {}),
          knowledgePackIds,
          knowledgeModuleIds,
          ...(knowledgeContractGroup ? { knowledgeContractGroup } : {}),
          referenceItemIds,
          allowAdult,
          ...(Object.keys(sharedSemantics).length > 0 ? { sharedSemantics } : {}),
        })
        .then((reply) => {
          if (reply.ok !== true) {
            console.warn("Failed to save orchestrator workspace state", reply.error.message);
            setError(
              t("orchestrator.workspaceSaveFailed", { message: reply.error.message }),
            );
          }
        })
        .catch((cause: unknown) => {
          console.warn("Failed to save orchestrator workspace state", cause);
        });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [
    prefabTerms,
    modelId,
    loraIds,
    systemLayer,
    systemLayerSource,
    writingLayer,
    mossLayout.width,
    mossLayout.height,
    mossLayout.boxes,
    knowledgePackIds,
    knowledgeModuleIds,
    knowledgeContractGroup,
    referenceItemIds,
    allowAdult,
    sharedSemantics,
    workspaceHydrated,
  ]);

  // The layer budget depends on the task shape, not on keystrokes; the layer
  // text itself is estimated locally, so typing does not call the main process.
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      void window.api.promptOrchestrator
        .getLayerBudget({
          skill,
          mode,
          outputFormat,
          vocabularyTokenBudget,
          imageCount: referenceImages.length,
          contextTokens: layerContextTokens,
          outputReserveTokens: 4096,
          referenceTokens,
          allowAdult,
        })
        .then((reply) => {
          if (!active) return;
          if (reply.ok === true) {
            setLayerBudget(reply.data);
            setLayerBudgetError("");
          } else {
            setLayerBudget(null);
            setLayerBudgetError(reply.error.message);
          }
        })
        .catch((cause: unknown) => {
          if (active) setLayerBudgetError(cause instanceof Error ? cause.message : String(cause));
        });
    }, 300);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [
    skill,
    mode,
    outputFormat,
    vocabularyTokenBudget,
    referenceImages.length,
    layerContextTokens,
    referenceTokens,
    allowAdult,
  ]);

  useEffect(() => {
    if (previousLayoutSignature.current === layoutSignature) return;
    previousLayoutSignature.current = layoutSignature;
    setResult(null);
    setSkillDraft(null);
    setSavedPromptId(null);
    setSavedSkillId(null);
  }, [layoutSignature]);

  useEffect(() => {
    if (modelSource === "local") {
      if (!localModel) {
        if (llmModelId) setLlmModelId("");
        return;
      }
      if (llmModelId !== LOCAL_LLAMA_MODEL_ID) {
        setLlmModelId(LOCAL_LLAMA_MODEL_ID);
      }
      return;
    }
    if (cloudModels.some((model) => model.id === llmModelId)) return;
    const routedId = routeDefaults.mainText ?? routeDefaults.fastText;
    const next =
      cloudModels.find((model) => model.id === routedId) ??
      cloudModels.find((model) => model.isDefault) ??
      cloudModels[0];
    setLlmModelId(next?.id ?? "");
  }, [cloudModels, localModel, llmModelId, modelSource, routeDefaults]);

  function changeModelSource(next: "cloud" | "local"): void {
    setModelSource(next);
    setResult(null);
    if (next === "local") {
      setLlmModelId(localModel ? LOCAL_LLAMA_MODEL_ID : "");
      return;
    }
    const routedId = routeDefaults.mainText ?? routeDefaults.fastText;
    const preferred =
      cloudModels.find((model) => model.id === routedId) ??
      cloudModels.find((model) => model.isDefault) ??
      cloudModels[0];
    if (preferred) setLlmModelId(preferred.id);
  }

  function changeMode(next: PromptOrchestrationMode): void {
    setMode(next);
    setResult(null);
    if (isVideoTask(next)) {
      setVideo((current) => ({
        ...current,
        shotCount: next === "video-long" ? Math.max(current.shotCount ?? 1, 6) : current.shotCount ?? 1,
      }));
    }
    setOutputFormat(defaultOutputFormat(next, skill));
  }

  function changeSkill(next: PromptOrchestrationSkill): void {
    const nextMode = defaultModeForSkill(next);
    setSkill(next);
    setMode(nextMode);
    setResult(null);
    setOutputFormat(defaultOutputFormat(nextMode, next));
    if (next === "minimaxH3") {
      setGuidanceMode("agent-led");
      setRightPanel("result");
    }
  }

  function changeGuidance(next: PromptGuidanceMode): void {
    setGuidanceMode(next);
    setRightPanel(next === "human-led" ? "prefab" : "result");
  }

  function updateSystemLayer(text: string): void {
    setSystemLayer(text);
    setSystemLayerSource(undefined);
  }

  /** Typing into the intent box makes the input user-authored again. */
  function changeIntentText(text: string): void {
    setPrompt(text);
    setPromptOrigin("user");
  }

  /** Reuses the generated prompt as the next intent without touching selections. */
  function reuseResultAsIntent(): void {
    if (!result) return;
    setPrompt(result.completePrompt);
    setPromptOrigin("result");
    setError("");
  }

  /** Panel calls carry the preset title so the source label stays truthful. */
  function updateSystemLayerWithSource(text: string, source: string | null): void {
    setSystemLayer(text);
    setSystemLayerSource(source ?? undefined);
  }

  function applyLibraryLayer(text: string, title: string): void {
    setSystemLayer(text);
    setSystemLayerSource(title);
  }

  async function applyLibraryPrompt(id: string): Promise<void> {
    if (!id) return;
    setError("");
    const detail = await getPromptDetail(id);
    const text = detail?.systemPrompt?.trim();
    if (!text) {
      setError(t("orchestrator.systemLayerMissing"));
      return;
    }
    applyLibraryLayer(text, detail.title);
  }

  function updateVideo<K extends keyof PromptVideoOrchestrationInput>(
    key: K,
    value: PromptVideoOrchestrationInput[K],
  ): void {
    setVideo((current) => ({ ...current, [key]: value }));
  }

  function addPrefabTerm(term: PromptVocabularySearchItem): void {
    setPrefabTerms((current) => {
      const existing = current.find((item) => item.id === term.id);
      if (existing) {
        // Re-picking an excluded term restores it as a normal recommendation.
        return existing.state === "excluded"
          ? current.map((item) => (item.id === term.id ? { ...item, state: "recommended" } : item))
          : current;
      }
      return [...current, { ...term, state: "recommended" }];
    });
  }

  function setPrefabTermState(id: string, state: PrefabTermState): void {
    setPrefabTerms((current) => current.map((term) => (term.id === id ? { ...term, state } : term)));
  }

  function removePrefabTerm(id: string): void {
    setPrefabTerms((current) => current.filter((term) => term.id !== id));
  }

  function clearPrefabTerms(): void {
    setPrefabTerms([]);
  }

  /**
   * Sends the result's terms back to the picker so the next run can iterate on
   * them. Existing locked or excluded rows are never overridden by the result.
   */
  async function backfillResultTerms(): Promise<number> {
    if (!result) return 0;
    const provenance = result.provenance ?? [];
    const rowsByTerm = new Map(
      provenance
        .filter((entry) => entry.termId)
        .map((entry) => [entry.termId as string, entry]),
    );
    const items: PrefabTerm[] = [];
    for (const term of result.selectedTerms) {
      const entry = rowsByTerm.get(term.id);
      if (entry && !shouldBackfillProvenance(entry)) continue;
      items.push({
        id: term.id,
        category: term.category,
        subcategory: null,
        en: term.en,
        zh: term.zh,
        series: term.series,
        template: term.template,
        validationStatus: term.validationStatus,
        state: backfillStateFor(entry),
      });
    }
    const covered = new Set(items.map((item) => item.id));
    const extraRows = provenance.filter((entry) =>
      entry.termId && !covered.has(entry.termId) && shouldBackfillProvenance(entry));
    if (extraRows.length > 0) {
      // Identity and artist rows have no term object on the result; resolve the
      // stored rows by their label (including the @artist spelling) once.
      const reply = await window.api.promptOrchestrator.resolveTerms({
        terms: extraRows.flatMap((entry) => [entry.label, `@${entry.label}`]),
      });
      if (reply.ok === true) {
        const resolved = new Map(reply.data.map((item) => [item.id, item]));
        for (const entry of extraRows) {
          const item = entry.termId ? resolved.get(entry.termId) : undefined;
          if (!item) continue;
          items.push({ ...item, state: backfillStateFor(entry) });
        }
      }
    }
    if (items.length === 0) return 0;
    setPrefabTerms((current) => mergeBackfillTerms(current, items));
    setRightPanel("prefab");
    return items.length;
  }

  function addReferenceImages(images: Array<{ fileName: string; dataUrl: string }>): void {
    const limit = referenceImageLimit(mode);
    setReferenceImages((current) => {
      // Reverse works on the image in hand: a newly picked image replaces the
      // previous one instead of silently sending both to the vision model.
      const base = mode === "reverse" ? [] : current;
      return [
        ...base,
        ...images.slice(0, Math.max(0, limit - base.length)).map((image) => ({
          ...image,
          id: crypto.randomUUID(),
        })),
      ];
    });
  }

  async function acceptReferenceFiles(files: File[]): Promise<void> {
    setError("");
    const remaining = Math.max(0, referenceImageLimit(mode) - referenceImages.length);
    if (remaining === 0) {
      setError(t("orchestrator.imageLimitReached"));
      return;
    }
    try {
      const selected = files.slice(0, remaining);
      if (selected.some((file) => file.size > 64 * 1024 * 1024)) {
        throw new Error(t("orchestrator.imageTooLarge"));
      }
      const images = await Promise.all(selected.map(async (file) => ({
        fileName: file.name || `pasted-image-${Date.now()}.png`,
        dataUrl: await downscaleImageToDataUrl(file),
      })));
      addReferenceImages(images);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function pasteReferenceImage(): Promise<void> {
    setError("");
    try {
      const readClipboard = window.electron?.readClipboardImage;
      if (!readClipboard) throw new Error(t("orchestrator.imageBridgeUnavailable"));
      const image = await readClipboard();
      if (!image) throw new Error(t("orchestrator.clipboardImageUnavailable"));
      const blob = base64ToBlob(image.base64, image.mimeType);
      addReferenceImages([{
        fileName: image.fileName,
        dataUrl: await downscaleImageToDataUrl(blob),
      }]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  const runBlockers = (() => {
    const blockers: string[] = [];
    if (!llmModelId) {
      blockers.push(t("orchestrator.blocker.model"));
    }
    if (hasGroupedContracts && !knowledgeContractGroup) {
      blockers.push(t("orchestrator.blocker.contractGroup"));
    }
    if (knowledgeSkillConflict) {
      blockers.push(
        t("orchestrator.blocker.knowledgeSkillConflict", {
          group: knowledgeSkillConflict.group,
          packs: knowledgeSkillConflict.packs.join(", "),
        }),
      );
    }
    const writingLayerTokens =
      estimatePromptTokens(systemLayer) + knowledgeTokens + contractTokens;
    if (
      writingLayerTokens > 0 &&
      layerBudget &&
      writingLayerTokens > layerBudget.budgetTokens
    ) {
      blockers.push(
        t("orchestrator.blocker.layerBudget", {
          over: writingLayerTokens - layerBudget.budgetTokens,
        }),
      );
    }
    const layoutMode =
      outputFormat === "layout" &&
      !isVideoTask(mode) &&
      supportsLayoutDraft(skill);
    if (
      outputFormat === "layout" &&
      skill !== "k2" &&
      !validCanvas(mossLayout.width, mossLayout.height)
    ) {
      blockers.push(t("orchestrator.blocker.canvasSize"));
    }
    if (layoutMode) {
      if (!prompt.trim()) blockers.push(t("orchestrator.blocker.prompt"));
      if (mossLayout.boxes.length === 0) {
        blockers.push(t("orchestrator.blocker.boxEmpty"));
      }
      mossLayout.boxes.forEach((box, index) => {
        if (box.label === "text" && !box.text?.trim()) {
          blockers.push(t("orchestrator.blocker.boxText", { index: index + 1 }));
        }
      });
    } else if (guidanceMode === "human-led" && !isVideoTask(mode)) {
      if (!prompt.trim()) blockers.push(t("orchestrator.blocker.prompt"));
      if (selectedTermIds.length === 0) {
        blockers.push(t("orchestrator.blocker.humanLed"));
      }
    } else if (mode === "random") {
      if (!subject.trim() || !setting.trim()) blockers.push(t("orchestrator.blocker.random"));
      if (randomCategories.length === 0) blockers.push(t("orchestrator.blocker.randomCategories"));
    } else if (mode === "reverse") {
      if (!prompt.trim() && referenceImages.length === 0) {
        blockers.push(t("orchestrator.blocker.reverse"));
      }
    } else if (mode === "video-frames" || mode === "video-long") {
      if (!prompt.trim() && referenceImages.length === 0) {
        blockers.push(t("orchestrator.blocker.videoFrames"));
      }
    } else if (mode === "video-multi-reference") {
      if (!prompt.trim() && referenceImages.length === 0 && !video.referencePlan?.trim()) {
        blockers.push(t("orchestrator.blocker.videoFrames"));
      }
    } else if (mode === "video-beat") {
      if (!prompt.trim() || !video.beatTimestamps?.trim()) {
        blockers.push(t("orchestrator.blocker.beat"));
      }
    } else if (isVideoTask(mode)) {
      if (!prompt.trim()) blockers.push(t("orchestrator.blocker.video"));
    } else {
      if (!prompt.trim()) blockers.push(t("orchestrator.blocker.prompt"));
      if (mode === "edit" && !editInstruction.trim()) {
        blockers.push(t("orchestrator.blocker.edit"));
      }
    }
    return blockers;
  })();

  const canRun =
    runBlockers.length === 0 && !isRunning && !isGeneratingSkill && !isAssistingLayout;

  // Derived from the same fields buildInput sends, so the pre-run summary and
  // the actual run cannot describe different rights.
  const taskContractPreview = useMemo(
    () =>
      resolvePromptTaskContract({
        mode,
        outputFormat,
        guidanceMode,
        skill,
        ...(isVideoTask(mode) ? { video } : {}),
        ...(referenceImages.length > 0
          ? { imageUrls: referenceImages.map((image) => image.dataUrl) }
          : {}),
      }),
    [mode, outputFormat, guidanceMode, skill, video, referenceImages],
  );

  function toggleRandomCategory(category: string): void {
    setRandomCategories((current) => current.includes(category)
      ? current.filter((item) => item !== category)
      : [...current, category]);
  }

  function buildInput(): PromptOrchestrationInput {
    return {
      prompt: prompt.trim() || undefined,
      mode,
      skill,
      // The artist pipeline control is image-only; a video task derives its
      // pipeline from the H3 rule card, so a stale selection must not leak in.
      ...(targetPipeline && !isVideoTask(mode) ? { targetPipeline } : {}),
      guidanceMode,
      ...(systemLayer.trim() || activeKnowledgeModules.length > 0
        ? {
            ...(systemLayer.trim()
              ? {
                  systemPromptLayer: systemLayer.trim(),
                  ...(systemLayerSource ? { systemPromptLayerSource: systemLayerSource } : {}),
                  ...(writingLayer.mode === "preset" && writingLayer.presetId
                    ? { systemPromptLayerPresetId: writingLayer.presetId }
                    : {}),
                }
              : {}),
            systemPromptLayerOutputReserve: 4096,
          }
        : {}),
      // The declared window also caps the tool loop's output share; it must be
      // sent even when no writing layer exists, otherwise a 32K engine is
      // priced as 8K and the final answer gets truncated.
      systemPromptLayerContextSize: layerContextTokens,
      ...(activeKnowledgeModules.length > 0
        ? {
            knowledgeModules: activeKnowledgeModules.map((module) => ({
              id: module.id,
              packId: module.packId,
              ...(module.packName ? { packName: module.packName } : {}),
              moduleKey: module.moduleKey,
              title: module.title,
              ...(module.layer ? { layer: module.layer } : {}),
              role: module.role,
              ...(module.contractGroups ? { contractGroups: module.contractGroups } : {}),
              tokens: module.tokens,
              content: module.content,
            })),
          }
        : {}),
      ...(referenceStyles.length > 0 ? { referenceStyles } : {}),
      ...(allowAdult ? { allowAdult: true } : {}),
      ...(Object.keys(sharedSemantics).length > 0 ? { sharedSemantics } : {}),
      series: series || undefined,
      ...(domain === "all" ? {} : { domain }),
      outputFormat,
      includePayload,
      ...(outputFormat === "layout" && skill !== "k2"
        ? { canvas: { width: Number(mossLayout.width), height: Number(mossLayout.height) } }
        : {}),
      ...(outputFormat === "layout" && supportsLayoutDraft(skill)
        ? {
            layout: {
              version: 1 as const,
              canvas: { width: Number(mossLayout.width), height: Number(mossLayout.height) },
              boxes: mossLayout.boxes,
            },
          }
        : {}),
      modelId: modelId.trim() || undefined,
      loraIds: splitIds(loraIds),
      selectedTermIds,
      lockedTermIds,
      referenceTermIds,
      excludedTermIds,
      vocabularyTokenBudget,
      ...(mode === "edit" && editInstruction.trim()
        ? { editInstruction: editInstruction.trim() }
        : {}),
      ...(mode === "random"
        ? {
            categories: randomCategories,
            random: {
              subject: subject.trim(),
              setting: setting.trim(),
              ...(seed.trim() ? { seed: seed.trim() } : {}),
            },
          }
        : {}),
      ...(supportsReferenceImages(mode)
        ? { imageUrls: referenceImages.map((image) => image.dataUrl) }
        : {}),
      ...(isVideoTask(mode) ? { video } : {}),
    };
  }

  async function run(): Promise<void> {
    if (!canRun) return;
    const id = ++requestId.current;
    const runId = crypto.randomUUID();
    setIsRunning(true);
    setError("");
    setCanceling(false);
    setLastRunStats(null);
    setStreaming({
      runId,
      stage: "planning",
      round: 0,
      text: "",
      fields: [],
      percent: 0,
      mode: "pending",
    });
    const applyEvent = (event: PromptOrchestratorStreamEvent): void => {
      if (id !== requestId.current) return;
      setStreaming((current) => {
        if (!current || current.runId !== runId) return current;
        switch (event.type) {
          case "phase":
            return { ...current, stage: event.stage, round: event.round };
          case "delta":
            return {
              ...current,
              text: `${current.text}${event.text}`.slice(-MAX_STREAM_PREVIEW),
            };
          case "structure":
            return { ...current, fields: event.fields, percent: event.percent };
          case "stats":
            setLastRunStats((previous) => ({ ...previous, ...event }));
            return {
              ...current,
              mode: event.mode,
              ...(event.firstTokenMs !== undefined ? { firstTokenMs: event.firstTokenMs } : {}),
              ...(event.completionTokens !== undefined
                ? { completionTokens: event.completionTokens }
                : {}),
              ...(event.tokensPerSecond !== undefined
                ? { tokensPerSecond: event.tokensPerSecond }
                : {}),
              source: event.source,
            };
          default:
            return current;
        }
      });
    };
    try {
      const reply = await window.api.promptOrchestrator.run(
        {
          input: buildInput(),
          llmModelId,
          runId,
        },
        { onEvent: applyEvent },
      );
      if (id !== requestId.current) return;
      if (reply.ok === true) {
        setResult(reply.data);
        setSavedPromptId(null);
        setRightPanel("result");
      } else {
        setError(
          reply.error.code === "CANCELLED"
            ? t("orchestrator.streaming.canceled")
            : reply.error.message,
        );
      }
    } catch (cause) {
      if (id === requestId.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (id === requestId.current) {
        setIsRunning(false);
        setStreaming((current) => (current?.stopped ? current : null));
        setCanceling(false);
      }
    }
  }

  /** Stops the in-flight run; the server aborts the request and reports CANCELLED. */
  async function cancelRun(): Promise<void> {
    const runId = streaming?.runId;
    if (!runId || canceling) return;
    setCanceling(true);
    try {
      await window.api.promptOrchestrator.cancel(runId);
      setStreaming((current) => (current ? { ...current, stopped: true } : current));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setCanceling(false);
    }
  }

  async function refineLayoutCaptions(): Promise<void> {
    if (!llmModelId || mossLayout.boxes.length === 0 || isAssistingLayout || isRunning) return;
    setIsAssistingLayout(true);
    setError("");
    setLayoutAssistNote("");
    // The API answers in request order, so keep the ids to map captions back.
    const requestedIds = mossLayout.boxes.map((box) => box.id);
    const runId = crypto.randomUUID();
    setAssistRunId(runId);
    try {
      const reply = await window.api.promptOrchestrator.refineLayoutCaptions({
        runId,
        draft: {
          version: 1,
          canvas: { width: Number(mossLayout.width), height: Number(mossLayout.height) },
          boxes: mossLayout.boxes,
        },
        ...(prompt.trim() ? { intent: prompt.trim() } : {}),
        llmModelId,
      });
      if (reply.ok !== true) {
        setError(
          reply.error.code === "CANCELLED"
            ? t("orchestrator.streaming.canceled")
            : reply.error.message,
        );
        return;
      }
      const { captions, status, warnings } = reply.data;
      mossLayout.setBoxes((current) => applyCaptionsToBoxes(current, requestedIds, captions));
      setLayoutAssistNote(
        status === "degraded"
          ? warnings.join(" ")
          : t("orchestrator.layout.captionRefined", { count: captions.length }),
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(/cancel/i.test(message) ? t("orchestrator.streaming.canceled") : message);
    } finally {
      setIsAssistingLayout(false);
      setAssistRunId(null);
    }
  }

  /** Stops a layout caption/reverse request; the request rejects as CANCELLED. */
  async function cancelAssistLayout(): Promise<void> {
    if (!assistRunId) return;
    try {
      const result = await window.api.promptOrchestrator.cancel(assistRunId);
      if (result.ok === true) {
        setLayoutAssistNote(t("orchestrator.layout.assistStopped"));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function reverseLayoutFromImage(file: File): Promise<void> {
    if (!llmModelId || isAssistingLayout || isRunning) return;
    if (mossLayout.boxes.length > 0) {
      const confirmed = await requestConfirmation({
        title: t("orchestrator.layout.reverseOverwriteTitle"),
        message: t("orchestrator.layout.reverseOverwriteMessage", {
          count: mossLayout.boxes.length,
        }),
        confirmText: t("orchestrator.layout.reverseOverwriteConfirm"),
        variant: "destructive",
      });
      if (!confirmed) return;
    }
    const previous = {
      boxes: mossLayout.boxes,
      selectedBoxId: mossLayout.selectedBoxId,
    };
    setIsAssistingLayout(true);
    setError("");
    setLayoutAssistNote("");
    const runId = crypto.randomUUID();
    setAssistRunId(runId);
    try {
      const dataUrl = await downscaleImageToDataUrl(file);
      const reply = await window.api.promptOrchestrator.reverseLayout({
        runId,
        images: [dataUrl],
        canvas: { width: Number(mossLayout.width), height: Number(mossLayout.height) },
        ...(prompt.trim() ? { intent: prompt.trim() } : {}),
        llmModelId,
      });
      if (reply.ok !== true) {
        setError(
          reply.error.code === "CANCELLED"
            ? t("orchestrator.streaming.canceled")
            : reply.error.message,
        );
        return;
      }
      const { draft, summary, status, warnings } = reply.data;
      if (draft.boxes.length === 0) {
        setLayoutAssistNote(warnings.join(" ") || t("orchestrator.layout.reverseEmpty"));
        return;
      }
      setLayoutUndo(previous.boxes.length > 0 ? previous : null);
      mossLayout.setBoxes(draft.boxes);
      mossLayout.setSelectedBoxId(draft.boxes[0].id);
      if (summary && !prompt.trim()) setPrompt(summary);
      const needsReview = draft.boxes.filter((box) => box.needsReview).length;
      setLayoutAssistNote(
        [
          t("orchestrator.layout.reverseDone", { count: draft.boxes.length }),
          ...(needsReview > 0
            ? [t("orchestrator.layout.reverseNeedsReview", { count: needsReview })]
            : []),
          ...(status === "degraded" ? warnings : []),
        ].join(" "),
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(/cancel/i.test(message) ? t("orchestrator.streaming.canceled") : message);
    } finally {
      setIsAssistingLayout(false);
      setAssistRunId(null);
    }
  }

  /** Restores the boxes replaced by the last reverse; one step only. */
  function undoReverseLayout(): void {
    if (!layoutUndo) return;
    mossLayout.setBoxes(layoutUndo.boxes);
    mossLayout.setSelectedBoxId(layoutUndo.selectedBoxId);
    setLayoutUndo(null);
    setLayoutAssistNote(t("orchestrator.layout.reverseUndone"));
  }

  /**
   * Empties the canvas after confirmation. There is no undo, so the pending
   * reverse snapshot is dropped to avoid restoring boxes onto a blank canvas.
   */
  async function clearLayoutCanvas(): Promise<void> {
    if (mossLayout.boxes.length === 0 || isAssistingLayout || isRunning) return;
    const confirmed = await requestConfirmation({
      title: t("orchestrator.layout.clearCanvasTitle"),
      message: t("orchestrator.layout.clearCanvasMessage", { count: mossLayout.boxes.length }),
      confirmText: t("orchestrator.layout.clearCanvasConfirm"),
      variant: "destructive",
    });
    if (!confirmed) return;
    mossLayout.clearBoxes();
    setLayoutUndo(null);
    setLayoutAssistNote("");
  }

  async function generateSkill(): Promise<void> {
    if (!prompt.trim() || !llmModelId || isVideoTask(mode) || isRunning || isGeneratingSkill) return;
    const id = ++skillRequestId.current;
    setIsGeneratingSkill(true);
    setError("");
    setSavedSkillId(null);
    try {
      const reply = await window.api.promptOrchestrator.generateSkill({
        input: buildInput(),
        llmModelId,
        skillName: skillName.trim() || undefined,
      });
      if (id !== skillRequestId.current) return;
      if (reply.ok === true) setSkillDraft(reply.data);
      else setError(reply.error.message);
    } catch (cause) {
      if (id === skillRequestId.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (id === skillRequestId.current) setIsGeneratingSkill(false);
    }
  }

  async function saveSkill(): Promise<string | null> {
    if (!skillDraft || savedSkillId || isSavingSkill) return savedSkillId;
    setIsSavingSkill(true);
    setError("");
    try {
      const created = await window.api.skill.create({
        name: skillDraft.name,
        description: skillDraft.description,
        instructions: skillDraft.content,
        content: skillDraft.content,
        protocol_type: "skill",
        is_favorite: false,
        tags: ["prompt-orchestration", skillDraft.ruleCard],
        version: "1.0.0",
        author: "PromptHub",
      });
      if (!created || typeof created.id !== "string") {
        throw new Error(t("orchestrator.skillSaveFailed"));
      }
      setSavedSkillId(created.id);
      return created.id;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return null;
    } finally {
      setIsSavingSkill(false);
    }
  }

  async function saveResultToLibrary(favorite: boolean): Promise<string | null> {
    if (!result || savedPromptId || isSavingToLibrary) return savedPromptId;
    setIsSavingToLibrary(true);
    setError("");
    try {
      const titleSource = (prompt.trim() || result.initialPrompt)
        .replace(/\s+/g, " ")
        .slice(0, 28);
      const created = await createPrompt({
        title: titleSource || t("orchestrator.savedPromptDefaultTitle"),
        description: t("orchestrator.savedPromptDescription", {
          skill: result.skill,
          mode: t(`orchestrator.modes.${result.mode}`),
        }),
        userPrompt: result.completePrompt,
        ...(systemLayer.trim() ? { systemPrompt: systemLayer.trim() } : {}),
        tags: [result.skill, result.mode, ...(result.outputFormat ? [result.outputFormat] : [])],
        folderId: null,
        source: "prompt-orchestrator",
      });
      if (favorite) {
        await updatePrompt(created.id, { isFavorite: true });
      }
      setSavedPromptId(created.id);
      return created.id;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return null;
    } finally {
      setIsSavingToLibrary(false);
    }
  }

  return {
    prompt, setPrompt: changeIntentText, promptOrigin, clearPromptOrigin: () => setPromptOrigin("user"),
    mode, setMode: changeMode, skill, setSkill: changeSkill,
    targetPipeline, setTargetPipeline,
    guidanceMode, setGuidanceMode: changeGuidance,
    outputFormat, setOutputFormat, includePayload, setIncludePayload,
    series, setSeries, domain, setDomain, seriesOptions,
    llmModelId, setLlmModelId, chatModels, cloudModels, localModel,
    modelSource, changeModelSource,
    modelId, setModelId, loraIds, setLoraIds,
    editInstruction, setEditInstruction, subject, setSubject, setting, setSetting,
    randomCategories, toggleRandomCategory,
    seed, setSeed, mossLayout,
    video, updateVideo, referenceImages, setReferenceImages,
    selectedTermIds, lockedTermIds, referenceTermIds, excludedTermIds,
    prefabTerms, addPrefabTerm, removePrefabTerm, setPrefabTermState, clearPrefabTerms,
    backfillResultTerms,
    vocabularyTokenBudget, setVocabularyTokenBudget,
    rightPanel, setRightPanel, result, error, isRunning, canRun, runBlockers, run,
    taskContractPreview,
    streaming, reuseResultAsIntent, lastRunStats, cancelRun, canceling,
    acceptReferenceFiles, pasteReferenceImage,
    isAssistingLayout, layoutAssistNote, refineLayoutCaptions, reverseLayoutFromImage, cancelAssistLayout,
    canUndoReverse: layoutUndo !== null,
    undoReverseLayout,
    clearLayoutCanvas,
    skillName, setSkillName, skillDraft, savedSkillId, isGeneratingSkill,
    isSavingSkill, canGenerateSkill: Boolean(
      prompt.trim() && llmModelId && !isVideoTask(mode) && !isRunning && !isGeneratingSkill,
    ),
    generateSkill, saveSkill,
    systemLayer, updateSystemLayer, applyLibraryLayer, systemLayerSource,
    updateSystemLayerWithSource,
    writingLayer, setWritingLayer,
    knowledgePacks, knowledgeModulesByPack,
    knowledgePackIds, knowledgeModuleIds, knowledgeTokens, contractModules, contractTokens,
    knowledgeContractGroup, setKnowledgeContractGroup, hasGroupedContracts,
    knowledgeModules: activeKnowledgeModules, knowledgeError,
    referenceItems, selectedReferenceItems, referenceItemIds, toggleReferenceItem, referenceTokens, referenceError,
    allowAdult, setAllowAdult,
    sharedSemantics, setSharedSemantics,
    toggleKnowledgePack, toggleKnowledgeModule,
    importKnowledgePack, deleteKnowledgePack,
    layerContextTokens, setLayerContextTokens,
    layerBudget, layerBudgetError,
    libraryPrompts, applyLibraryPrompt,
    savedPromptId, isSavingToLibrary, saveResultToLibrary,
  };
}
