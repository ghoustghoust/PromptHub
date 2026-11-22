import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  PromptArtistPipeline,
  PromptGuidanceMode,
  PromptOrchestrationInput,
  PromptOrchestrationMode,
  PromptOrchestrationOutputFormat,
  PromptOrchestrationResult,
  PromptOrchestrationSkill,
  PromptSkillDraft,
  PromptTermDomain,
  PromptVideoOrchestrationInput,
  PromptVocabularySearchItem,
} from "@prompthub/shared/types";
import { supportsReferenceImages } from "@prompthub/shared/types";
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
import { useMossLayoutEditor } from "./useMossLayoutEditor";

export interface OrchestratorReferenceImage {
  id: string;
  fileName: string;
  dataUrl: string;
}

/** How the user wants a picked term to be treated by the orchestrator. */
export type PrefabTermState = "locked" | "recommended" | "reference" | "excluded";

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

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read image"));
    reader.readAsDataURL(file);
  });
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
  const [systemLayer, setSystemLayer] = useState("");
  const [systemLayerSource, setSystemLayerSource] = useState<string | undefined>();
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
  const [layoutAssistNote, setLayoutAssistNote] = useState("");
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
    setReferenceImages((current) => [
      ...current,
      ...images.slice(0, Math.max(0, limit - current.length)).map((image) => ({
        ...image,
        id: crypto.randomUUID(),
      })),
    ]);
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
      if (selected.some((file) => file.size > 10 * 1024 * 1024)) {
        throw new Error(t("orchestrator.imageTooLarge"));
      }
      const images = await Promise.all(selected.map(async (file) => ({
        fileName: file.name || `pasted-image-${Date.now()}.png`,
        dataUrl: await fileToDataUrl(file),
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
      addReferenceImages([{
        fileName: image.fileName,
        dataUrl: `data:${image.mimeType};base64,${image.base64}`,
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

  const canRun = runBlockers.length === 0 && !isRunning && !isGeneratingSkill;

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
      ...(targetPipeline ? { targetPipeline } : {}),
      guidanceMode,
      ...(systemLayer.trim()
        ? {
            systemPromptLayer: systemLayer.trim(),
            ...(systemLayerSource ? { systemPromptLayerSource: systemLayerSource } : {}),
          }
        : {}),
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
    setIsRunning(true);
    setError("");
    try {
      const reply = await window.api.promptOrchestrator.run({
        input: buildInput(),
        llmModelId,
      });
      if (id !== requestId.current) return;
      if (reply.ok === true) {
        setResult(reply.data);
        setSavedPromptId(null);
        setRightPanel("result");
      } else {
        setError(reply.error.message);
      }
    } catch (cause) {
      if (id === requestId.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (id === requestId.current) setIsRunning(false);
    }
  }

  async function refineLayoutCaptions(): Promise<void> {
    if (!llmModelId || mossLayout.boxes.length === 0 || isAssistingLayout) return;
    setIsAssistingLayout(true);
    setError("");
    setLayoutAssistNote("");
    try {
      const reply = await window.api.promptOrchestrator.refineLayoutCaptions({
        draft: {
          version: 1,
          canvas: { width: Number(mossLayout.width), height: Number(mossLayout.height) },
          boxes: mossLayout.boxes,
        },
        ...(prompt.trim() ? { intent: prompt.trim() } : {}),
        llmModelId,
      });
      if (reply.ok !== true) {
        setError(reply.error.message);
        return;
      }
      const { captions, status, warnings } = reply.data;
      mossLayout.setBoxes((current) =>
        current.map((box, index) => {
          const caption = captions[index]?.trim();
          return caption ? { ...box, caption } : box;
        }),
      );
      setLayoutAssistNote(
        status === "degraded"
          ? warnings.join(" ")
          : t("orchestrator.layout.captionRefined", { count: captions.length }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsAssistingLayout(false);
    }
  }

  async function reverseLayoutFromImage(file: File): Promise<void> {
    if (!llmModelId || isAssistingLayout) return;
    setIsAssistingLayout(true);
    setError("");
    setLayoutAssistNote("");
    try {
      const dataUrl = await fileToDataUrl(file);
      const reply = await window.api.promptOrchestrator.reverseLayout({
        images: [dataUrl],
        canvas: { width: Number(mossLayout.width), height: Number(mossLayout.height) },
        ...(prompt.trim() ? { intent: prompt.trim() } : {}),
        llmModelId,
      });
      if (reply.ok !== true) {
        setError(reply.error.message);
        return;
      }
      const { draft, summary, status, warnings } = reply.data;
      if (draft.boxes.length === 0) {
        setLayoutAssistNote(warnings.join(" ") || t("orchestrator.layout.reverseEmpty"));
        return;
      }
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
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsAssistingLayout(false);
    }
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
    prompt, setPrompt, mode, setMode: changeMode, skill, setSkill: changeSkill,
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
    acceptReferenceFiles, pasteReferenceImage,
    isAssistingLayout, layoutAssistNote, refineLayoutCaptions, reverseLayoutFromImage,
    skillName, setSkillName, skillDraft, savedSkillId, isGeneratingSkill,
    isSavingSkill, canGenerateSkill: Boolean(
      prompt.trim() && llmModelId && !isVideoTask(mode) && !isRunning && !isGeneratingSkill,
    ),
    generateSkill, saveSkill,
    systemLayer, updateSystemLayer, applyLibraryLayer, systemLayerSource,
    libraryPrompts, applyLibraryPrompt,
    savedPromptId, isSavingToLibrary, saveResultToLibrary,
  };
}
