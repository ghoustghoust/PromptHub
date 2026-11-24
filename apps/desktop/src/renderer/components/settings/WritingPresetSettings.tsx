import { useCallback, useEffect, useMemo, useState } from "react";
import { CopyIcon, FileTextIcon, PlusIcon, SaveIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  ImportedPromptWritingPreset,
  PromptWritingMethodology,
  PromptWritingPreset,
  PromptWritingPresetSummary,
  PromptWritingPresetTarget,
  PromptWritingPresetValidationStatus,
} from "@prompthub/shared/types";
import { estimatePromptTokens } from "@prompthub/shared/utils/prompt-token-estimate";
import { removeSectionHeading } from "@prompthub/shared/utils/writing-preset-sections";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Select } from "../ui/Select";
import { Textarea } from "../ui/Textarea";
import { SettingSection } from "./shared";

type DetailTab = "compressed" | "original" | "sections";

interface PresetDraft {
  name: string;
  targetSkill: PromptWritingPresetTarget;
  methodology: PromptWritingMethodology;
  validationStatus: PromptWritingPresetValidationStatus;
  description: string;
  sourceFile: string;
  compressedContent: string;
  originalContent: string | null;
}

const TARGETS: PromptWritingPresetTarget[] = ["any", "moss", "moodyMoss", "k2", "minimaxH3"];
const METHODOLOGIES: PromptWritingMethodology[] = [
  "writing-guide",
  "unit-template",
  "official-guide",
  "reverse-guide",
];
const VALIDATION_STATUSES: PromptWritingPresetValidationStatus[] = [
  "validated",
  "unverified",
  "deprecated",
];

function draftOf(preset: PromptWritingPreset): PresetDraft {
  return {
    name: preset.name,
    targetSkill: preset.targetSkill,
    methodology: preset.methodology,
    validationStatus: preset.validationStatus,
    description: preset.description ?? "",
    sourceFile: preset.sourceFile ?? "",
    compressedContent: preset.compressedContent,
    originalContent: preset.originalContent,
  };
}

function Badge({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "primary" | "warning" }) {
  const className = tone === "primary"
    ? "bg-primary/10 text-primary"
    : tone === "warning"
      ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
      : "bg-muted text-muted-foreground";
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${className}`}>{children}</span>;
}

/**
 * Writing presets are the selectable system-prompt layer. The editor only
 * stores text and provenance; token budgets and injection belong to the
 * orchestrator so the same numbers are shown here and enforced there.
 */
export function WritingPresetSettings() {
  const { t } = useTranslation();
  const [summaries, setSummaries] = useState<PromptWritingPresetSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preset, setPreset] = useState<PromptWritingPreset | null>(null);
  const [draft, setDraft] = useState<PresetDraft | null>(null);
  const [tab, setTab] = useState<DetailTab>("compressed");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [importDraft, setImportDraft] = useState<ImportedPromptWritingPreset | null>(null);
  const [importName, setImportName] = useState("");
  const [importTarget, setImportTarget] = useState<PromptWritingPresetTarget>("any");
  const [importMethodology, setImportMethodology] = useState<PromptWritingMethodology>("writing-guide");
  const [importCompressed, setImportCompressed] = useState("");

  const api = window.api.promptWritingPresets;

  const refreshList = useCallback(async () => {
    if (!api) return;
    const reply = await api.list();
    if (reply.ok !== true) {
      setError(reply.error.message);
      return;
    }
    setSummaries(reply.data);
    setSelectedId((current) => {
      if (current && reply.data.some((item) => item.id === current)) return current;
      return reply.data[0]?.id ?? null;
    });
  }, [api]);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  useEffect(() => {
    let active = true;
    if (!api || !selectedId) {
      setPreset(null);
      setDraft(null);
      return () => {
        active = false;
      };
    }
    void api.get(selectedId).then((reply) => {
      if (!active) return;
      if (reply.ok !== true) {
        setError(reply.error.message);
        return;
      }
      setPreset(reply.data);
      setDraft(reply.data ? draftOf(reply.data) : null);
      setTab("compressed");
      setConfirmDelete(false);
    });
    return () => {
      active = false;
    };
  }, [api, selectedId, refreshList]);

  const dirty = useMemo(() => {
    if (!preset || !draft) return false;
    const baseline = draftOf(preset);
    return (Object.keys(baseline) as Array<keyof PresetDraft>).some(
      (key) => baseline[key] !== draft[key],
    );
  }, [preset, draft]);

  const compressedTokens = draft ? estimatePromptTokens(draft.compressedContent) : 0;

  const save = async () => {
    if (!api || !draft) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const reply = await api.save({
        ...(preset && !preset.builtin ? { id: preset.id } : {}),
        name: draft.name,
        targetSkill: draft.targetSkill,
        methodology: draft.methodology,
        validationStatus: draft.validationStatus,
        description: draft.description.trim() || null,
        sourceFile: draft.sourceFile.trim() || null,
        compressedContent: draft.compressedContent,
        originalContent: draft.originalContent,
      });
      if (reply.ok !== true) {
        setError(reply.error.message);
        return;
      }
      setPreset(reply.data);
      setDraft(draftOf(reply.data));
      setSelectedId(reply.data.id);
      setNotice(t("writingPresets.savedNotice"));
      await refreshList();
    } finally {
      setBusy(false);
    }
  };

  const duplicateBuiltin = async () => {
    if (!api || !preset) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const reply = await api.save({
        name: `${preset.name} ${t("writingPresets.copySuffix")}`,
        targetSkill: preset.targetSkill,
        methodology: preset.methodology,
        validationStatus: "unverified",
        description: preset.description,
        sourceFile: preset.sourceFile,
        compressedContent: preset.compressedContent,
        originalContent: preset.originalContent,
      });
      if (reply.ok !== true) {
        setError(reply.error.message);
        return;
      }
      setSelectedId(reply.data.id);
      setNotice(t("writingPresets.copiedNotice"));
      await refreshList();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!api || !preset || preset.builtin) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const reply = await api.remove(preset.id);
      if (reply.ok !== true) {
        setError(reply.error.message);
        return;
      }
      setConfirmDelete(false);
      setNotice(t("writingPresets.deletedNotice"));
      await refreshList();
    } finally {
      setBusy(false);
    }
  };

  const startImport = async () => {
    if (!api) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const reply = await api.importFile();
      if (reply.ok !== true) {
        setError(reply.error.message);
        return;
      }
      if (!reply.data) return;
      setImportDraft(reply.data);
      setImportName(reply.data.suggestedName);
      setImportTarget("any");
      setImportMethodology("writing-guide");
      setImportCompressed("");
      setTab("compressed");
    } finally {
      setBusy(false);
    }
  };

  const saveImport = async () => {
    if (!api || !importDraft) return;
    if (!importCompressed.trim()) {
      setError(t("writingPresets.compressedRequired"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const reply = await api.save({
        name: importName.trim() || importDraft.suggestedName,
        targetSkill: importTarget,
        methodology: importMethodology,
        validationStatus: "unverified",
        sourceFile: importDraft.sourceFile,
        description: t("writingPresets.importedDescription"),
        compressedContent: importCompressed,
        originalContent: importDraft.extractedContent,
      });
      if (reply.ok !== true) {
        setError(reply.error.message);
        return;
      }
      setImportDraft(null);
      setImportCompressed("");
      setSelectedId(reply.data.id);
      setNotice(t("writingPresets.importedNotice"));
      await refreshList();
    } finally {
      setBusy(false);
    }
  };

  const closeImport = () => {
    setImportDraft(null);
    setImportCompressed("");
    setError("");
  };

  const exportPresets = async () => {
    if (!api) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const reply = await api.exportPresets();
      if (reply.ok !== true) {
        setError(reply.error.message);
        return;
      }
      if (reply.data) {
        setNotice(t("writingPresets.exportedNotice", { count: reply.data.count }));
      }
    } finally {
      setBusy(false);
    }
  };

  const importPresetBundle = async () => {
    if (!api) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const reply = await api.importPresetBundle();
      if (reply.ok !== true) {
        setError(reply.error.message);
        return;
      }
      if (reply.data) {
        setNotice(t("writingPresets.importedBundleNotice", { count: reply.data.imported }));
        await refreshList();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4" data-testid="writing-presets-settings">
      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive" data-testid="writing-preset-error">
          {error}
        </p>
      )}
      {notice && (
        <p className="text-[11px] text-emerald-600 dark:text-emerald-400" data-testid="writing-preset-notice">
          {notice}
        </p>
      )}
      <SettingSection title={t("writingPresets.library")}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-4 py-3">
          <p className="max-w-3xl text-xs text-muted-foreground">{t("writingPresets.libraryHint")}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void exportPresets()}
              disabled={busy}
              data-testid="writing-preset-export"
            >
              {t("writingPresets.exportPresets")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void importPresetBundle()}
              disabled={busy}
              data-testid="writing-preset-import-bundle"
            >
              {t("writingPresets.importPresets")}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void startImport()} disabled={busy} data-testid="writing-preset-import">
              <UploadIcon className="h-3.5 w-3.5" aria-hidden="true" />
              {busy ? t("writingPresets.importing") : t("writingPresets.import")}
            </Button>
          </div>
        </div>
        <div className="grid gap-0 lg:grid-cols-[280px_minmax(0,1fr)]">
          <div className="max-h-[560px] overflow-y-auto border-b border-border/70 lg:border-b-0 lg:border-r">
            {summaries.length === 0 ? (
              <div className="space-y-1 px-4 py-6 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">{t("writingPresets.emptyTitle")}</p>
                <p>{t("writingPresets.emptyHint")}</p>
              </div>
            ) : (
              summaries.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className={`block w-full border-b border-border/50 px-3 py-2.5 text-left transition-colors hover:bg-muted/30 ${
                    selectedId === item.id ? "bg-primary/5" : ""
                  }`}
                  data-testid={`writing-preset-row-${item.id}`}
                >
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <span className="min-w-0 flex-1 truncate text-xs font-medium" title={item.name}>
                      {item.name}
                    </span>
                    {item.builtin && <Badge tone="primary">{t("writingPresets.builtin")}</Badge>}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                    <Badge>{t(`writingPresets.targets.${item.targetSkill}`)}</Badge>
                    <Badge>{t(`writingPresets.methodologies.${item.methodology}`)}</Badge>
                    <span>{t("writingPresets.compressedTokens", { tokens: item.compressedTokenEstimate })}</span>
                  </div>
                </button>
              ))
            )}
          </div>
          <div className="min-w-0">
            {importDraft ? (
              <div className="space-y-3 p-4" data-testid="writing-preset-import-panel">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h4 className="text-sm font-medium">{t("writingPresets.importTitle")}</h4>
                    <p className="text-[11px] text-muted-foreground">
                      {t("writingPresets.importSource", { file: importDraft.sourceFile })} · {importDraft.encoding}
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={closeImport} disabled={busy}>
                    {t("writingPresets.cancel")}
                  </Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Input label={t("writingPresets.name")} value={importName} onChange={(event) => setImportName(event.target.value)} variant="outlined" />
                  <label className="space-y-1.5 text-sm font-medium">
                    <span>{t("writingPresets.target")}</span>
                    <Select
                      value={importTarget}
                      options={TARGETS.map((value) => ({ value, label: t(`writingPresets.targets.${value}`) }))}
                      onChange={(value) => setImportTarget(value as PromptWritingPresetTarget)}
                      presentation="form"
                    />
                  </label>
                  <label className="space-y-1.5 text-sm font-medium">
                    <span>{t("writingPresets.methodology")}</span>
                    <Select
                      value={importMethodology}
                      options={METHODOLOGIES.map((value) => ({ value, label: t(`writingPresets.methodologies.${value}`) }))}
                      onChange={(value) => setImportMethodology(value as PromptWritingMethodology)}
                      presentation="form"
                    />
                  </label>
                </div>
                <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                    <span className="font-medium text-foreground">{t("writingPresets.importExtracted")}</span>
                    <span>
                      {t("writingPresets.charAndToken", {
                        chars: importDraft.charCount,
                        tokens: importDraft.tokenEstimate,
                      })}
                      {" 路 "}
                      {t("writingPresets.sectionCount", { count: importDraft.sections.length })}
                    </span>
                  </div>
                  <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-muted-foreground">
                    {importDraft.extractedContent}
                  </pre>
                  <p className="mt-2 text-[11px] text-muted-foreground">{t("writingPresets.originalNotInjected")}</p>
                </div>
                <Textarea
                  label={t("writingPresets.importCompressed")}
                  value={importCompressed}
                  onChange={(event) => setImportCompressed(event.target.value)}
                  rows={10}
                  placeholder={t("writingPresets.importCompressedPlaceholder")}
                  data-testid="writing-preset-import-compressed"
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    <span>{t("writingPresets.compressedTokens", { tokens: estimatePromptTokens(importCompressed) })}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setImportCompressed(importDraft.extractedContent)}
                      data-testid="writing-preset-use-full-text"
                    >
                      {t("writingPresets.useFullText")}
                    </Button>
                    <span>{t("writingPresets.useFullTextWarning")}</span>
                  </div>
                  <Button size="sm" onClick={() => void saveImport()} disabled={busy || !importName.trim()} data-testid="writing-preset-save-import">
                    <SaveIcon className="h-3.5 w-3.5" aria-hidden="true" />
                    {busy ? t("writingPresets.saving") : t("writingPresets.saveImport")}
                  </Button>
                </div>
              </div>
            ) : !preset || !draft ? (
              <div className="flex h-full min-h-48 flex-col items-center justify-center gap-2 px-4 text-center text-xs text-muted-foreground">
                <FileTextIcon className="h-7 w-7" aria-hidden="true" />
                <p>{t("writingPresets.selectHint")}</p>
              </div>
            ) : (
              <div className="space-y-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <h4
                        className="min-w-0 max-w-full truncate text-sm font-medium"
                        title={preset.name}
                        data-testid="writing-preset-title"
                      >
                        {preset.name}
                      </h4>
                      {preset.builtin && <Badge tone="primary">{t("writingPresets.builtinReadOnly")}</Badge>}
                      <Badge tone={preset.validationStatus === "validated" ? "primary" : "warning"}>
                        {t(`writingPresets.validationStatus.${preset.validationStatus}`)}
                      </Badge>
                    </div>
                    {preset.description && (
                      <p className="mt-1 max-w-2xl text-[11px] text-muted-foreground">{preset.description}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {preset.builtin && (
                      <Button size="sm" variant="secondary" onClick={() => void duplicateBuiltin()} disabled={busy} data-testid="writing-preset-copy">
                        <CopyIcon className="h-3.5 w-3.5" aria-hidden="true" />
                        {t("writingPresets.copyToEdit")}
                      </Button>
                    )}
                    {!preset.builtin && (
                      <Button
                        size="sm"
                        variant={confirmDelete ? "danger" : "ghost"}
                        onClick={() => void remove()}
                        disabled={busy}
                        data-testid="writing-preset-delete"
                      >
                        <Trash2Icon className="h-3.5 w-3.5" aria-hidden="true" />
                        {confirmDelete ? t("writingPresets.confirmDelete") : t("writingPresets.delete")}
                      </Button>
                    )}
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    label={t("writingPresets.name")}
                    value={draft.name}
                    onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                    disabled={preset.builtin}
                    variant="outlined"
                  />
                  <label className="space-y-1.5 text-sm font-medium">
                    <span>{t("writingPresets.target")}</span>
                    <Select
                      value={draft.targetSkill}
                      options={TARGETS.map((value) => ({ value, label: t(`writingPresets.targets.${value}`) }))}
                      onChange={(value) => setDraft({ ...draft, targetSkill: value as PromptWritingPresetTarget })}
                      disabled={preset.builtin}
                      presentation="form"
                    />
                  </label>
                  <label className="space-y-1.5 text-sm font-medium">
                    <span>{t("writingPresets.methodology")}</span>
                    <Select
                      value={draft.methodology}
                      options={METHODOLOGIES.map((value) => ({ value, label: t(`writingPresets.methodologies.${value}`) }))}
                      onChange={(value) => setDraft({ ...draft, methodology: value as PromptWritingMethodology })}
                      disabled={preset.builtin}
                      presentation="form"
                    />
                  </label>
                  <label className="space-y-1.5 text-sm font-medium">
                    <span>{t("writingPresets.validation")}</span>
                    <Select
                      value={draft.validationStatus}
                      options={VALIDATION_STATUSES.map((value) => ({ value, label: t(`writingPresets.validationStatus.${value}`) }))}
                      onChange={(value) => setDraft({ ...draft, validationStatus: value as PromptWritingPresetValidationStatus })}
                      disabled={preset.builtin}
                      presentation="form"
                    />
                  </label>
                  <Input
                    label={t("writingPresets.sourceFile")}
                    value={draft.sourceFile}
                    onChange={(event) => setDraft({ ...draft, sourceFile: event.target.value })}
                    disabled={preset.builtin}
                    variant="outlined"
                  />
                  <Input
                    label={t("writingPresets.description")}
                    value={draft.description}
                    onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                    disabled={preset.builtin}
                    variant="outlined"
                  />
                </div>
                <div className="flex flex-wrap gap-1 rounded-md border border-border bg-muted/30 p-1" role="tablist">
                  {(["compressed", "original", "sections"] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      role="tab"
                      aria-selected={tab === value}
                      onClick={() => setTab(value)}
                      className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                        tab === value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                      }`}
                      data-testid={`writing-preset-tab-${value}`}
                    >
                      {t(`writingPresets.tabs.${value}`)}
                    </button>
                  ))}
                </div>
                {tab === "compressed" && (
                  <div className="space-y-2">
                    <Textarea
                      value={draft.compressedContent}
                      onChange={(event) => setDraft({ ...draft, compressedContent: event.target.value })}
                      rows={14}
                      disabled={preset.builtin}
                      placeholder={t("writingPresets.compressedPlaceholder")}
                      data-testid="writing-preset-compressed"
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                      <span>
                        {t("writingPresets.charAndToken", {
                          chars: draft.compressedContent.length,
                          tokens: compressedTokens,
                        })}
                        {" 路 "}
                        {t("writingPresets.estimateNote")}
                      </span>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => void save()}
                          disabled={busy || preset.builtin || !dirty || !draft.name.trim() || !draft.compressedContent.trim()}
                          data-testid="writing-preset-save"
                        >
                          <SaveIcon className="h-3.5 w-3.5" aria-hidden="true" />
                          {busy ? t("writingPresets.saving") : t("writingPresets.save")}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
                {tab === "original" && (
                  <div className="space-y-2">
                    {preset.originalContent ? (
                      <>
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                          <span>
                            {t("writingPresets.charAndToken", {
                              chars: preset.originalContent.length,
                              tokens: preset.originalTokenEstimate ?? 0,
                            })}
                          </span>
                          <span>{t("writingPresets.originalNotInjected")}</span>
                        </div>
                        <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-border/70 bg-muted/20 p-3 text-[11px] leading-relaxed">
                          {preset.originalContent}
                        </pre>
                      </>
                    ) : (
                      <p className="rounded-lg border border-border/70 bg-muted/20 px-3 py-6 text-center text-xs text-muted-foreground">
                        {t("writingPresets.noOriginal")}
                      </p>
                    )}
                  </div>
                )}
                {tab === "sections" && (
                  <div className="space-y-2">
                    <p className="text-[11px] text-muted-foreground">{t("writingPresets.sectionsHint")}</p>
                    <div className="overflow-hidden rounded-lg border border-border/70">
                      <table className="w-full text-left text-[11px]">
                        <thead className="bg-muted/40 text-muted-foreground">
                          <tr>
                            <th className="px-3 py-2 font-medium">{t("writingPresets.sectionTitle")}</th>
                            <th className="px-3 py-2 text-right font-medium">{t("writingPresets.chars")}</th>
                            <th className="px-3 py-2 text-right font-medium">{t("writingPresets.tokens")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {preset.compressedSections.map((section, index) => (
                            <tr key={section.id} className="border-t border-border/50">
                              <td className="px-3 py-1.5">
                                <span>{section.title}</span>
                                {!preset.builtin && index > 0 && (
                                  <button
                                    type="button"
                                    className="ml-2 text-[10px] text-muted-foreground underline-offset-2 hover:underline"
                                    onClick={() =>
                                      setDraft({
                                        ...draft,
                                        compressedContent: removeSectionHeading(
                                          draft.compressedContent,
                                          section.title,
                                        ),
                                      })
                                    }
                                    data-testid={`writing-preset-merge-${section.id}`}
                                  >
                                    {t("writingPresets.mergeIntoPrevious")}
                                  </button>
                                )}
                              </td>
                              <td className="px-3 py-1.5 text-right text-muted-foreground">{section.charCount}</td>
                              <td className="px-3 py-1.5 text-right text-muted-foreground">{section.tokenEstimate}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </SettingSection>
      <p className="flex items-start gap-2 text-[11px] text-muted-foreground">
        <PlusIcon className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
        {t("writingPresets.layerNotice")}
      </p>
    </div>
  );
}
