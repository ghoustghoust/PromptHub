import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  PromptKnowledgeContractGroup,
  PromptKnowledgeImportCommitResult,
  PromptKnowledgeImportPreview,
  PromptKnowledgeModule,
  PromptKnowledgePack,
  PromptWritingLayerBudgetPreview,
  PromptWritingPreset,
  PromptWritingPresetSummary,
} from "@prompthub/shared/types";
import { estimatePromptTokens } from "@prompthub/shared/utils/prompt-token-estimate";
import { Trash2Icon } from "lucide-react";
import { Select } from "../ui/Select";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { Textarea } from "../ui/Textarea";
import {
  EMPTY_WRITING_LAYER,
  assemblePresetLayerText,
  normalizeSectionIds,
  writingLayerSections,
  type WritingLayerSelection,
} from "./prompt-writing-layer";

const CONTEXT_OPTIONS = [
  { value: "8192", label: "8K" },
  { value: "32768", label: "32K" },
  { value: "65536", label: "64K" },
];

interface Props {
  selection: WritingLayerSelection;
  text: string;
  source: string | null;
  disabled?: boolean;
  contextTokens: number;
  contextLocked: boolean;
  budget: PromptWritingLayerBudgetPreview | null;
  budgetError: string;
  knowledgePacks: PromptKnowledgePack[];
  knowledgeModulesByPack: Record<string, PromptKnowledgeModule[]>;
  knowledgePackIds: string[];
  knowledgeModuleIds: string[];
  /** Tokens of the selected modules; they share the same layer budget. */
  knowledgeTokens: number;
  /** Contract modules of the selected packs; always-on, never selectable. */
  contractModules: PromptKnowledgeModule[];
  contractTokens: number;
  /** Project type used to select one contract group; empty means none chosen. */
  contractGroup?: PromptKnowledgeContractGroup;
  hasGroupedContracts: boolean;
  knowledgeError?: string;
  onSelectionChange: (next: WritingLayerSelection) => void;
  onTextChange: (text: string, source: string | null) => void;
  onContextTokensChange: (value: number) => void;
  onToggleKnowledgePack: (id: string) => void;
  onToggleKnowledgeModule: (id: string) => void;
  onContractGroupChange: (group: PromptKnowledgeContractGroup | undefined) => void;
  onImportKnowledgePack: (preview: PromptKnowledgeImportPreview) => Promise<PromptKnowledgeImportCommitResult | null>;
  onDeleteKnowledgePack: (id: string) => Promise<void>;
}

/**
 * Picks and previews the writing layer. Everything here is text the user chose
 * to inject; the panel never shortens it silently and shows the same budget the
 * orchestrator will enforce.
 */
export function PromptWritingLayerPanel({
  selection,
  text,
  source,
  disabled = false,
  contextTokens,
  contextLocked,
  budget,
  budgetError,
  knowledgePacks,
  knowledgeModulesByPack,
  knowledgePackIds,
  knowledgeModuleIds,
  knowledgeTokens,
  contractModules,
  contractTokens,
  contractGroup,
  hasGroupedContracts,
  knowledgeError = "",
  onSelectionChange,
  onTextChange,
  onContextTokensChange,
  onToggleKnowledgePack,
  onToggleKnowledgeModule,
  onContractGroupChange,
  onImportKnowledgePack,
  onDeleteKnowledgePack,
}: Props) {
  const { t } = useTranslation();
  const [summaries, setSummaries] = useState<PromptWritingPresetSummary[]>([]);
  const [preset, setPreset] = useState<PromptWritingPreset | null>(null);
  const [open, setOpen] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [saving, setSaving] = useState(false);
  const [editNotice, setEditNotice] = useState("");
  const directoryInputRef = useRef<HTMLInputElement>(null);
  const [knowledgePreview, setKnowledgePreview] = useState<PromptKnowledgeImportPreview | null>(null);
  const [knowledgeImportOpen, setKnowledgeImportOpen] = useState(false);
  const [previewingPack, setPreviewingPack] = useState(false);
  const [importingPack, setImportingPack] = useState(false);
  const [knowledgeImportError, setKnowledgeImportError] = useState("");
  const [knowledgeNotice, setKnowledgeNotice] = useState("");

  const api = window.api.promptWritingPresets;

  useEffect(() => {
    let active = true;
    if (!api) return () => {
      active = false;
    };
    void api.list().then((reply) => {
      if (!active) return;
      if (reply.ok === true) setSummaries(reply.data);
      else setError(reply.error.message);
    });
    return () => {
      active = false;
    };
  }, [api]);

  useEffect(() => {
    let active = true;
    if (!api || !selection.presetId) {
      setPreset(null);
      return () => {
        active = false;
      };
    }
    void api.get(selection.presetId).then((reply) => {
      if (!active) return;
      if (reply.ok !== true) {
        setError(reply.error.message);
        setPreset(null);
        return;
      }
      setPreset(reply.data);
      setEditing(false);
      setEditNotice("");
    });
    return () => {
      active = false;
    };
  }, [api, selection.presetId]);

  const availableSections = useMemo(
    () => writingLayerSections(preset, selection.variant),
    [preset, selection.variant],
  );

  const filteredSummaries = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return summaries;
    return summaries.filter((item) => {
      const haystack = `${item.name} ${item.description ?? ""} ${item.sourceFile ?? ""} ${item.targetSkill} ${item.methodology}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }, [query, summaries]);

  const selectedSections = useMemo(
    () => availableSections.filter((section) => selection.sectionIds.includes(section.id)),
    [availableSections, selection.sectionIds],
  );

  const assembled = useMemo(() => {
    if (selection.mode !== "preset" || !preset) return "";
    return assemblePresetLayerText(preset, selection.variant, selection.sectionIds);
  }, [preset, selection.mode, selection.sectionIds, selection.variant]);

  // Section ids come from the document text; after a preset or variant change
  // the stored ids may not exist, so they are normalized once. An explicit
  // "select none" is preserved instead of being normalized back to everything.
  const lastSelectionKey = useRef("");
  useEffect(() => {
    if (selection.mode !== "preset" || !preset) return;
    const key = `${preset.id}:${selection.variant}`;
    const fresh = lastSelectionKey.current !== key;
    lastSelectionKey.current = key;
    const ids = fresh
      ? normalizeSectionIds(preset, selection.variant, selection.sectionIds)
      : selection.sectionIds;
    if (
      fresh &&
      (ids.length !== selection.sectionIds.length ||
        ids.some((id, index) => id !== selection.sectionIds[index]))
    ) {
      onSelectionChange({ ...selection, sectionIds: ids });
    }
    const nextText = assemblePresetLayerText(preset, selection.variant, ids);
    if (nextText !== text) {
      onTextChange(nextText, preset.name);
    }
  }, [preset, selection, text, onSelectionChange, onTextChange]);

  const applySelection = useCallback(
    (next: WritingLayerSelection) => {
      onSelectionChange(next);
    },
    [onSelectionChange],
  );

  async function savePresetEdit(): Promise<void> {
    if (!api || !preset || preset.builtin || !editText.trim()) return;
    setSaving(true);
    setError("");
    try {
      const reply = await api.save({
        id: preset.id,
        name: preset.name,
        targetSkill: preset.targetSkill,
        methodology: preset.methodology,
        validationStatus: preset.validationStatus,
        description: preset.description,
        sourceFile: preset.sourceFile,
        compressedContent: editText,
        originalContent: preset.originalContent,
      });
      if (reply.ok !== true) {
        setError(reply.error.message);
        return;
      }
      setPreset(reply.data);
      setEditing(false);
      setEditNotice(t("orchestrator.writingLayer.editSaved"));
      const list = await api.list();
      if (list.ok === true) setSummaries(list.data);
    } finally {
      setSaving(false);
    }
  }

  const toggleSection = (id: string) => {
    const ids = selection.sectionIds.includes(id)
      ? selection.sectionIds.filter((item) => item !== id)
      : [...selection.sectionIds, id];
    applySelection({ ...selection, sectionIds: ids });
  };

  useEffect(() => {
    const input = directoryInputRef.current;
    if (!input) return;
    // React has no typed prop for the directory picker.
    input.setAttribute("webkitdirectory", "");
    input.setAttribute("directory", "");
  }, []);

  async function previewKnowledgeDirectory(file: File | undefined): Promise<void> {
    if (!file) return;
    const absolutePath = window.electron?.getPathForFile?.(file) ?? "";
    const separator = Math.max(absolutePath.lastIndexOf("/"), absolutePath.lastIndexOf("\\"));
    const rootPath = separator > 0 ? absolutePath.slice(0, separator) : "";
    setKnowledgeNotice("");
    setKnowledgeImportError("");
    if (!rootPath) {
      setKnowledgeImportError(t("orchestrator.writingLayer.directoryFailed"));
      return;
    }
    setPreviewingPack(true);
    try {
      const reply = await window.api.promptKnowledge.previewPack({ rootPath });
      if (reply.ok !== true) {
        setKnowledgeImportError(reply.error.message);
        return;
      }
      setKnowledgePreview(reply.data);
      setKnowledgeImportOpen(true);
    } catch (cause) {
      setKnowledgeImportError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPreviewingPack(false);
    }
  }

  async function confirmKnowledgeImport(): Promise<void> {
    if (!knowledgePreview) return;
    setImportingPack(true);
    setKnowledgeImportError("");
    try {
      const result = await onImportKnowledgePack(knowledgePreview);
      if (!result) {
        setKnowledgeImportError(t("orchestrator.writingLayer.importFailed"));
        return;
      }
      setKnowledgeImportOpen(false);
      setKnowledgePreview(null);
      setKnowledgeNotice(
        t("orchestrator.writingLayer.importDone", { count: result.moduleCount }),
      );
    } finally {
      setImportingPack(false);
    }
  }

  function setPreviewModuleRole(
    packIndex: number,
    moduleIndex: number,
    role: PromptKnowledgeModule["role"],
  ): void {
    setKnowledgePreview((current) => {
      if (!current) return current;
      return {
        ...current,
        packs: current.packs.map((pack, index) => index !== packIndex
          ? pack
          : {
              ...pack,
              modules: pack.modules.map((module, modulePosition) =>
                modulePosition === moduleIndex ? { ...module, role } : module),
            }),
      };
    });
  }

  const usedTokens = estimatePromptTokens(text) + knowledgeTokens + contractTokens;
  const budgetTokens = budget?.budgetTokens ?? null;
  const overBudget = budgetTokens !== null && usedTokens > budgetTokens;
  const percent = budgetTokens && budgetTokens > 0
    ? Math.min(100, Math.round((usedTokens / budgetTokens) * 100))
    : 0;

  const activePreset = selection.presetId
    ? summaries.find((item) => item.id === selection.presetId) ?? null
    : null;

  return (
    <div className="space-y-2 rounded-lg border border-border/70 p-3" data-testid="orchestrator-writing-layer">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-xs font-medium">{t("orchestrator.writingLayer.title")}</span>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          {source && <span className="max-w-[16rem] truncate" title={source}>{source}</span>}
          <span data-testid="writing-layer-tokens">
            {t("orchestrator.writingLayer.meter", { used: usedTokens, budget: budgetTokens ?? "?" })}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-1 rounded-md border border-border bg-muted/30 p-1" role="group">
        {(["preset", "custom"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={selection.mode === value}
            onClick={() => {
              setOpen(value === "preset");
              if (value === "custom") {
                onSelectionChange({ ...EMPTY_WRITING_LAYER });
                onTextChange("", null);
              } else {
                onSelectionChange({ mode: "preset", presetId: null, variant: "compressed", sectionIds: [] });
                onTextChange("", null);
              }
            }}
            disabled={disabled}
            className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
              selection.mode === value
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            data-testid={`writing-layer-mode-${value}`}
          >
            {t(`orchestrator.writingLayer.modes.${value}`)}
          </button>
        ))}
      </div>

      <div
        className={`h-1.5 overflow-hidden rounded-full ${overBudget ? "bg-destructive/20" : "bg-muted"}`}
        role="progressbar"
        aria-valuenow={usedTokens}
        aria-valuemax={budgetTokens ?? undefined}
      >
        <div
          className={`h-full transition-all ${overBudget ? "bg-destructive" : percent > 85 ? "bg-amber-500" : "bg-primary"}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span data-testid="writing-layer-breakdown">
          {budget
            ? t("orchestrator.writingLayer.breakdown", {
                context: budget.contextTokens,
                output: budget.outputReserveTokens,
                contract: budget.contractTokens,
                vocabulary: budget.vocabularyTokens,
              })
            : t("orchestrator.writingLayer.budgetPending")}
        </span>
        <label className="flex items-center gap-1.5">
          <span>{t("orchestrator.writingLayer.context")}</span>
          <Select
            value={String(contextTokens)}
            options={CONTEXT_OPTIONS}
            onChange={(value) => onContextTokensChange(Number(value))}
            disabled={contextLocked || disabled}
            presentation="compact"
            ariaLabel={t("orchestrator.writingLayer.context")}
          />
        </label>
      </div>
      {contextLocked && (
        <p className="text-[11px] text-muted-foreground">{t("orchestrator.writingLayer.contextLocked")}</p>
      )}
      {overBudget && (
        <p className="text-xs text-destructive" data-testid="writing-layer-over-budget">
          {t("orchestrator.writingLayer.overBudget", {
            over: usedTokens - (budgetTokens ?? 0),
          })}
        </p>
      )}
      {budgetError && <p className="text-xs text-destructive">{budgetError}</p>}

      <div className="space-y-2 rounded-md border border-border/60 p-2" data-testid="writing-layer-knowledge">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-medium">{t("orchestrator.writingLayer.knowledgeTitle")}</span>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground" data-testid="writing-layer-knowledge-tokens">
              {t("orchestrator.writingLayer.knowledgeTokens", { tokens: knowledgeTokens })}
            </span>
            {contractTokens > 0 && (
              <span className="text-[11px] text-muted-foreground" data-testid="writing-layer-contract-tokens">
                {t("orchestrator.writingLayer.contractTokens", { tokens: contractTokens })}
              </span>
            )}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => directoryInputRef.current?.click()}
              disabled={disabled || previewingPack}
              data-testid="writing-layer-knowledge-import"
            >
              {previewingPack
                ? t("orchestrator.writingLayer.importPreviewing")
                : t("orchestrator.writingLayer.importPack")}
            </Button>
          </div>
        </div>
        <input
          ref={directoryInputRef}
          type="file"
          className="hidden"
          data-testid="writing-layer-knowledge-directory"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            void previewKnowledgeDirectory(file);
          }}
        />
        <p className="text-[11px] text-muted-foreground">
          {t("orchestrator.writingLayer.knowledgeHint")}
        </p>
        {hasGroupedContracts && (
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-1" data-testid="writing-layer-contract-groups">
              <span className="text-[11px] text-muted-foreground">
                {t("orchestrator.writingLayer.contractGroupLabel")}
              </span>
              {(["script", "storyboard", "novel"] as const).map((group) => (
                <button
                  key={group}
                  type="button"
                  aria-pressed={contractGroup === group}
                  onClick={() => onContractGroupChange(contractGroup === group ? undefined : group)}
                  disabled={disabled}
                  className={`rounded border px-1.5 py-0.5 text-[11px] transition-colors ${
                    contractGroup === group
                      ? "border-primary/50 bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                  data-testid={`writing-layer-contract-group-${group}`}
                >
                  {t(`orchestrator.writingLayer.groups.${group}`)}
                </button>
              ))}
            </div>
            {!contractGroup && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400" data-testid="writing-layer-contract-group-hint">
                {t("orchestrator.writingLayer.contractGroupHint")}
              </p>
            )}
          </div>
        )}
        {knowledgePacks.length === 0 ? (
          <p className="text-[11px] text-muted-foreground" data-testid="writing-layer-knowledge-empty">
            {t("orchestrator.writingLayer.knowledgeEmpty")}
          </p>
        ) : (
          <div className="max-h-44 space-y-1 overflow-y-auto">
            {knowledgePacks.map((pack) => {
              const selected = knowledgePackIds.includes(pack.id);
              const modules = knowledgeModulesByPack[pack.id] ?? [];
              return (
                <div key={pack.id}>
                  <div className="flex items-center gap-1">
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded px-1 py-1 text-[11px] hover:bg-muted/30">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => onToggleKnowledgePack(pack.id)}
                        disabled={disabled}
                        data-testid={`writing-layer-knowledge-pack-${pack.id}`}
                      />
                      <span className="min-w-0 flex-1 truncate font-medium" title={pack.name}>
                        {pack.name}
                      </span>
                      <span className="shrink-0 text-muted-foreground">
                        {pack.version ? `v${pack.version}` : pack.kind}
                      </span>
                    </label>
                    <button
                      type="button"
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                      aria-label={t("orchestrator.writingLayer.deletePack", { name: pack.name })}
                      title={t("orchestrator.writingLayer.deletePack", { name: pack.name })}
                      onClick={() => void onDeleteKnowledgePack(pack.id)}
                      disabled={disabled}
                      data-testid={`writing-layer-knowledge-delete-${pack.id}`}
                    >
                      <Trash2Icon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {selected && (
                    <div className="ml-5 space-y-0.5 border-l border-border/60 pl-2">
                      {modules.length === 0 ? (
                        <p className="py-1 text-[10px] text-muted-foreground">
                          {t("orchestrator.writingLayer.knowledgeLoadingModules")}
                        </p>
                      ) : (
                        <>
                          {contractModules
                            .filter((module) => module.packId === pack.id)
                            .map((module) => (
                              <div
                                key={module.id}
                                className="flex items-center gap-2 rounded px-1 py-0.5 text-[11px] text-muted-foreground"
                                data-testid={`writing-layer-knowledge-contract-${module.id}`}
                              >
                                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px]">
                                  {t("orchestrator.writingLayer.contractBadge")}
                                </span>
                                <span className="min-w-0 flex-1 truncate" title={module.title}>
                                  {module.title}
                                </span>
                                <span className="shrink-0 text-[10px]">{module.tokens}</span>
                              </div>
                            ))}
                          {modules
                            .filter((module) => module.role === "knowledge")
                            .map((module) => (
                              <label
                                key={module.id}
                                className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-[11px] hover:bg-muted/30"
                              >
                                <input
                                  type="checkbox"
                                  checked={knowledgeModuleIds.includes(module.id)}
                                  onChange={() => onToggleKnowledgeModule(module.id)}
                                  disabled={disabled}
                                  data-testid={`writing-layer-knowledge-module-${module.id}`}
                                />
                                <span className="min-w-0 flex-1 truncate" title={module.title}>
                                  {module.title}
                                </span>
                                <span className="shrink-0 text-[10px] text-muted-foreground">
                                  {module.layer ?? "H"} · {module.tokens}
                                </span>
                              </label>
                            ))}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {knowledgeError && <p className="text-xs text-destructive">{knowledgeError}</p>}
        {knowledgeNotice && (
          <p className="text-[11px] text-emerald-600 dark:text-emerald-400">{knowledgeNotice}</p>
        )}
      </div>

      {selection.mode === "preset" ? (
        <div className="space-y-2">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("orchestrator.writingLayer.searchPlaceholder")}
            aria-label={t("orchestrator.writingLayer.searchPlaceholder")}
            variant="outlined"
            data-testid="writing-layer-search"
          />
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-0 flex-1 space-y-1 text-xs font-medium">
              <span>{t("orchestrator.writingLayer.preset")}</span>
              <Select
                value={selection.presetId ?? ""}
                options={[
                  { value: "", label: t("orchestrator.writingLayer.pickPreset") },
                  ...filteredSummaries.map((item) => ({ value: item.id, label: item.name })),
                ]}
                onChange={(value) =>
                  applySelection({
                    mode: "preset",
                    presetId: value || null,
                    variant: "compressed",
                    sectionIds: [],
                  })
                }
                disabled={disabled}
                presentation="form"
                ariaLabel={t("orchestrator.writingLayer.preset")}
              />
            </label>
            <button
              type="button"
              className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
              onClick={() => setOpen((value) => !value)}
              data-testid="writing-layer-toggle-sections"
            >
              {open ? t("orchestrator.writingLayer.hideSections") : t("orchestrator.writingLayer.showSections")}
            </button>
          </div>

          {activePreset && (
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <span>{t(`orchestrator.writingLayer.targets.${activePreset.targetSkill}`)}</span>
              <span>·</span>
              <span>{t(`orchestrator.writingLayer.methodologies.${activePreset.methodology}`)}</span>
              <span>·</span>
              <span>{t(`orchestrator.writingLayer.validation.${activePreset.validationStatus}`)}</span>
            </div>
          )}

          {preset?.originalContent && (
            <div className="flex items-center gap-1 rounded-md border border-border bg-muted/30 p-1" role="group">
              {(["compressed", "original"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={selection.variant === value}
                  onClick={() => applySelection({ ...selection, variant: value, sectionIds: [] })}
                  disabled={disabled}
                  className={`rounded px-2 py-1 text-[11px] font-medium transition-colors ${
                    selection.variant === value
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  data-testid={`writing-layer-variant-${value}`}
                >
                  {t(`orchestrator.writingLayer.variants.${value}`)}
                </button>
              ))}
            </div>
          )}

          {open && availableSections.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>{t("orchestrator.writingLayer.sectionCount", { count: selectedSections.length, total: availableSections.length })}</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="underline-offset-2 hover:underline"
                    onClick={() => applySelection({ ...selection, sectionIds: availableSections.map((section) => section.id) })}
                    disabled={disabled}
                  >
                    {t("orchestrator.writingLayer.selectAll")}
                  </button>
                  <button
                    type="button"
                    className="underline-offset-2 hover:underline"
                    onClick={() => applySelection({ ...selection, sectionIds: [] })}
                    disabled={disabled}
                  >
                    {t("orchestrator.writingLayer.selectNone")}
                  </button>
                </div>
              </div>
              <div className="max-h-40 overflow-y-auto rounded-md border border-border/70" data-testid="writing-layer-sections">
                {availableSections.map((section) => (
                  <label
                    key={section.id}
                    className="flex cursor-pointer items-start gap-2 border-b border-border/40 px-2 py-1.5 text-[11px] last:border-0 hover:bg-muted/30"
                  >
                    <input
                      type="checkbox"
                      checked={selection.sectionIds.includes(section.id)}
                      onChange={() => toggleSection(section.id)}
                      disabled={disabled}
                      className="mt-0.5"
                      data-testid={`writing-layer-section-${section.id}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium" title={section.title}>{section.title}</span>
                      <span className="text-muted-foreground">
                        {t("orchestrator.writingLayer.sectionTokens", {
                          chars: section.charCount,
                          tokens: section.tokenEstimate,
                        })}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {preset && (
            <div>
              <p className="mb-1 text-[11px] text-muted-foreground">{t("orchestrator.writingLayer.preview")}</p>
              <pre
                className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border/70 bg-muted/20 p-2 text-[11px] leading-relaxed"
                data-testid="writing-layer-preview"
              >
                {assembled || t("orchestrator.writingLayer.emptyPreview")}
              </pre>
            </div>
          )}
          {preset && (
            <div className="space-y-2 rounded-md border border-border/60 p-2">
              {editing ? (
                <>
                  <Textarea
                    value={editText}
                    onChange={(event) => setEditText(event.target.value)}
                    rows={8}
                    data-testid="writing-layer-edit-text"
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                    <span>
                      {t("orchestrator.writingLayer.editMeter", {
                        chars: editText.length,
                        tokens: estimatePromptTokens(editText),
                      })}
                    </span>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditing(false);
                          setEditNotice("");
                        }}
                        disabled={saving}
                      >
                        {t("orchestrator.writingLayer.cancelEdit")}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void savePresetEdit()}
                        disabled={saving || !editText.trim()}
                        data-testid="writing-layer-edit-save"
                      >
                        {saving
                          ? t("orchestrator.writingLayer.savingEdit")
                          : t("orchestrator.writingLayer.saveEdit")}
                      </Button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                  <span>
                    {preset.builtin
                      ? t("orchestrator.writingLayer.builtinEditHint")
                      : t("orchestrator.writingLayer.editHint")}
                  </span>
                  {!preset.builtin && (
                    <button
                      type="button"
                      className="underline-offset-2 hover:underline"
                      onClick={() => {
                        setEditing(true);
                        setEditText(preset.compressedContent);
                        setEditNotice("");
                      }}
                      disabled={disabled}
                      data-testid="writing-layer-edit"
                    >
                      {t("orchestrator.writingLayer.edit")}
                    </button>
                  )}
                </div>
              )}
              {editNotice && <p className="text-[11px] text-emerald-600 dark:text-emerald-400">{editNotice}</p>}
            </div>
          )}
          {!selection.presetId && (
            <p className="text-[11px] text-muted-foreground">{t("orchestrator.writingLayer.pickHint")}</p>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      ) : (
        <div className="space-y-1">
          <Textarea
            value={text}
            onChange={(event) => onTextChange(event.target.value, null)}
            placeholder={t("orchestrator.writingLayer.customPlaceholder")}
            rows={5}
            disabled={disabled}
            data-testid="writing-layer-custom"
          />
          <p className="text-[11px] text-muted-foreground">{t("orchestrator.writingLayer.customHint")}</p>
        </div>
      )}

      <Modal
        isOpen={knowledgeImportOpen}
        onClose={() => {
          if (importingPack) return;
          setKnowledgeImportOpen(false);
          setKnowledgePreview(null);
          setKnowledgeImportError("");
        }}
        title={t("orchestrator.writingLayer.importTitle")}
        size="lg"
        footer={(
          <div className="flex items-center justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setKnowledgeImportOpen(false);
                setKnowledgePreview(null);
                setKnowledgeImportError("");
              }}
              disabled={importingPack}
            >
              {t("orchestrator.writingLayer.importCancel")}
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => void confirmKnowledgeImport()}
              disabled={importingPack || !knowledgePreview}
              data-testid="knowledge-import-confirm"
            >
              {importingPack
                ? t("orchestrator.writingLayer.importing")
                : t("orchestrator.writingLayer.importConfirm")}
            </Button>
          </div>
        )}
      >
        {knowledgePreview && (
          <div className="space-y-3 text-xs" data-testid="knowledge-import-dialog">
            <div className="rounded-md border border-border/70 p-2">
              <p className="font-medium">
                {knowledgePreview.packs.map((pack) => pack.name).join(", ")}
              </p>
              <p className="text-muted-foreground">
                {t("orchestrator.writingLayer.importSummary", {
                  modules: knowledgePreview.moduleCount,
                  tokens: knowledgePreview.totalTokens,
                  bytes: knowledgePreview.totalBytes,
                })}
              </p>
            </div>
            <div>
              <p className="mb-1 font-medium">{t("orchestrator.writingLayer.importModulesTitle")}</p>
              <ul className="max-h-52 space-y-1 overflow-y-auto" data-testid="knowledge-import-modules">
                {knowledgePreview.packs.flatMap((pack, packIndex) =>
                  pack.modules.map((module, moduleIndex) => (
                    <li
                      key={`${packIndex}-${module.moduleKey}-${moduleIndex}`}
                      className="flex items-center gap-2 rounded px-1 py-0.5"
                    >
                      <span className="min-w-0 flex-1 truncate" title={module.title}>
                        {module.title}
                      </span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {module.layer} · {module.tokens}
                      </span>
                      <select
                        className="shrink-0 rounded border border-border bg-background px-1 py-0.5 text-[11px]"
                        value={module.role}
                        onChange={(event) =>
                          setPreviewModuleRole(
                            packIndex,
                            moduleIndex,
                            event.target.value as PromptKnowledgeModule["role"],
                          )
                        }
                        data-testid={`knowledge-import-role-${packIndex}-${moduleIndex}`}
                      >
                        {(["contract", "knowledge", "reference"] as const).map((role) => (
                          <option key={role} value={role}>
                            {t(`orchestrator.writingLayer.roles.${role}`)}
                          </option>
                        ))}
                      </select>
                    </li>
                  )),
                )}
              </ul>
            </div>
            <div>
              <p className="mb-1 font-medium">{t("orchestrator.writingLayer.importConflictTitle")}</p>
              {knowledgePreview.conflicts.length === 0 ? (
                <p className="text-muted-foreground" data-testid="knowledge-import-conflicts">
                  {t("orchestrator.writingLayer.importNoConflicts")}
                </p>
              ) : (
                <ul className="max-h-28 space-y-1 overflow-y-auto" data-testid="knowledge-import-conflicts">
                  {knowledgePreview.conflicts.map((conflict, index) => (
                    <li key={`${conflict.packName}-${conflict.moduleKey}-${index}`} className="text-muted-foreground">
                      {conflict.packName} · {conflict.moduleKey} · {conflict.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="mb-1 font-medium">{t("orchestrator.writingLayer.importSkippedTitle")}</p>
              {knowledgePreview.skipped.length === 0 ? (
                <p className="text-muted-foreground" data-testid="knowledge-import-skipped">
                  {t("orchestrator.writingLayer.importNothingSkipped")}
                </p>
              ) : (
                <ul className="max-h-28 space-y-1 overflow-y-auto" data-testid="knowledge-import-skipped">
                  {knowledgePreview.skipped.map((entry, index) => (
                    <li key={`${entry.path}-${index}`} className="text-muted-foreground">
                      {entry.path} · {entry.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {knowledgeImportError && (
              <p className="text-xs text-destructive" data-testid="knowledge-import-error">
                {knowledgeImportError}
              </p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
