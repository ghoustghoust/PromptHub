import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { XIcon } from "lucide-react";
import type {
  PromptAssetImportCommitResult,
  PromptAssetImportPreview,
  PromptReferenceImportCommitResult,
  PromptReferenceImportPreview,
} from "@prompthub/shared/types";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";

export type PromptLibraryImportMode = "reference" | "asset";

interface Props {
  mode: PromptLibraryImportMode;
  isOpen: boolean;
  onClose: () => void;
  /** Called after a successful import so the caller can refresh its list. */
  onImported: () => void;
}

interface PreviewSummary {
  itemCount: number;
  skipped: Array<{ label: string; reason: string }>;
  conflicts: Array<{ label: string; reason: string }>;
  /** Per-category counts of the color cards. */
  categories: Array<{ name: string; count: number }>;
  /** Per-library counts of the picture assets. */
  counts: Array<{ name: string; count: number }>;
}

interface ImportSummary {
  itemCount: number;
  updatedCount: number;
}

function summarizeReference(preview: PromptReferenceImportPreview): PreviewSummary {
  return {
    itemCount: preview.items.length,
    skipped: preview.skipped.map((entry) => ({
      label: entry.path.split(/[\\/]/).pop() ?? entry.path,
      reason: entry.reason,
    })),
    conflicts: preview.conflicts.map((entry) => ({
      label: entry.path.split(/[\\/]/).pop() ?? entry.path,
      reason: entry.reason,
    })),
    categories: preview.categories,
    counts: [],
  };
}

function summarizeAssets(preview: PromptAssetImportPreview): PreviewSummary {
  return {
    itemCount: preview.items.length,
    skipped: preview.skipped.map((entry) => ({
      label: entry.id,
      reason: entry.reason,
    })),
    conflicts: preview.conflicts.map((entry) => ({
      label: entry.id,
      reason: entry.detail ? `${entry.reason}: ${entry.detail}` : entry.reason,
    })),
    categories: [],
    counts: Object.entries(preview.counts).map(([name, count]) => ({ name, count })),
  };
}

/**
 * Import flow of the two source libraries: pick the source directories, read
 * what an import would write, then write it. The main process owns the scan,
 * so the counts shown here are the counts it found.
 */
export function PromptLibraryImportModal({
  mode,
  isOpen,
  onClose,
  onImported,
}: Props) {
  const { t } = useTranslation();
  const [sources, setSources] = useState<string[]>([]);
  const [preview, setPreview] = useState<PreviewSummary | null>(null);
  const [result, setResult] = useState<ImportSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    setSources([]);
    setPreview(null);
    setResult(null);
    setError("");
  }, [isOpen, mode]);

  async function addSources(): Promise<void> {
    const picked = await window.electron?.selectImportFolders?.(mode);
    if (!picked || picked.length === 0) return;
    setSources((current) => {
      const next = [...current];
      for (const folder of picked) {
        if (!next.includes(folder)) next.push(folder);
      }
      return next;
    });
    setPreview(null);
    setResult(null);
  }

  async function runPreview(): Promise<void> {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      if (mode === "reference") {
        const reply = await window.api.promptReference.preview({ roots: sources });
        if (reply.ok !== true) {
          setError(reply.error.message);
          return;
        }
        setPreview(summarizeReference(reply.data));
        return;
      }
      const reply = await window.api.promptAsset.preview({ rootPath: sources[0] ?? "" });
      if (reply.ok !== true) {
        setError(reply.error.message);
        return;
      }
      setPreview(summarizeAssets(reply.data));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function runImport(): Promise<void> {
    setBusy(true);
    setError("");
    try {
      if (mode === "reference") {
        const reply = await window.api.promptReference.importLibrary({ roots: sources });
        if (reply.ok !== true) {
          setError(reply.error.message);
          return;
        }
        const commit: PromptReferenceImportCommitResult = reply.data;
        setResult({ itemCount: commit.itemIds.length, updatedCount: 0 });
      } else {
        const reply = await window.api.promptAsset.importLibrary({ rootPath: sources[0] ?? "" });
        if (reply.ok !== true) {
          setError(reply.error.message);
          return;
        }
        const commit: PromptAssetImportCommitResult = reply.data;
        setResult({ itemCount: commit.inserted, updatedCount: commit.updated });
      }
      onImported();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  const canPreview = sources.length > 0 && !busy;
  const canImport = canPreview && preview !== null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        mode === "reference"
          ? t("orchestrator.library.importReferenceTitle")
          : t("orchestrator.library.importAssetTitle")
      }
      subtitle={t("orchestrator.library.importHint")}
      size="lg"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose} disabled={busy} data-testid="library-import-close">
            {t("orchestrator.library.close")}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void runPreview()}
            disabled={!canPreview}
            data-testid="library-import-preview"
          >
            {busy ? t("orchestrator.library.previewing") : t("orchestrator.library.preview")}
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() => void runImport()}
            disabled={!canImport || busy}
            data-testid="library-import-commit"
          >
            {busy ? t("orchestrator.library.importing") : t("orchestrator.library.import")}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 text-xs">
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-foreground">
              {t("orchestrator.library.sources")}
            </span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void addSources()}
              disabled={busy}
              data-testid="library-import-add-source"
            >
              {t("orchestrator.library.addSource")}
            </Button>
          </div>
          {sources.length === 0 ? (
            <p className="text-muted-foreground" data-testid="library-import-no-source">
              {t("orchestrator.library.noSource")}
            </p>
          ) : (
            <ul className="space-y-1" data-testid="library-import-sources">
              {sources.map((source) => (
                <li
                  key={source}
                  className="flex items-center gap-2 rounded border border-border/70 px-2 py-1"
                >
                  <span className="min-w-0 flex-1 truncate" title={source}>
                    {source}
                  </span>
                  <button
                    type="button"
                    aria-label={t("orchestrator.library.removeSource")}
                    onClick={() => {
                      setSources((current) => current.filter((entry) => entry !== source));
                      setPreview(null);
                    }}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <XIcon className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {error && (
          <p className="text-destructive" data-testid="library-import-error">
            {error}
          </p>
        )}

        {preview && (
          <div className="space-y-2 rounded border border-border/70 p-2" data-testid="library-import-preview-summary">
            <p data-testid="library-import-item-count">
              {t("orchestrator.library.itemCount", { count: preview.itemCount })}
            </p>
            {preview.categories.length > 0 && (
              <p className="text-muted-foreground">
                {preview.categories
                  .map((entry) => `${entry.name} ${entry.count}`)
                  .join(" · ")}
              </p>
            )}
            {preview.counts.length > 0 && (
              <p className="text-muted-foreground">
                {preview.counts
                  .map((entry) => `${entry.name} ${entry.count}`)
                  .join(" · ")}
              </p>
            )}
            {preview.skipped.length > 0 && (
              <div className="space-y-1">
                <p className="font-medium">
                  {t("orchestrator.library.skipped", { count: preview.skipped.length })}
                </p>
                <ul className="max-h-24 space-y-0.5 overflow-y-auto text-muted-foreground">
                  {preview.skipped.slice(0, 20).map((entry, index) => (
                    <li key={`${entry.label}-${index}`} className="truncate">
                      {entry.label} · {entry.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {preview.conflicts.length > 0 && (
              <div className="space-y-1">
                <p className="font-medium">
                  {t("orchestrator.library.conflicts", { count: preview.conflicts.length })}
                </p>
                <ul className="max-h-24 space-y-0.5 overflow-y-auto text-muted-foreground">
                  {preview.conflicts.slice(0, 20).map((entry, index) => (
                    <li key={`${entry.label}-${index}`} className="truncate">
                      {entry.label} · {entry.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {result && (
          <p className="text-emerald-600 dark:text-emerald-400" data-testid="library-import-result">
            {t("orchestrator.library.imported", {
              count: result.itemCount,
              updated: result.updatedCount,
            })}
          </p>
        )}
      </div>
    </Modal>
  );
}
