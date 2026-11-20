import { CheckIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { resolveTermKey } from "@prompthub/shared/utils/prompt-term-key";
import type { PromptVocabularySearchItem } from "@prompthub/shared/types";

const CJK_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

/** Underscores and escape slashes are import artifacts; keep the text readable. */
export function formatTermLabel(term: PromptVocabularySearchItem): string {
  if (term.template) return term.template;
  return term.en.replace(/\\/g, "").replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

interface PromptTermChipProps {
  term: PromptVocabularySearchItem;
  selected: boolean;
  onToggle: () => void;
  hint?: string | null;
  testId: string;
}

export function PromptTermChip({
  term,
  selected,
  onToggle,
  hint,
  testId,
}: PromptTermChipProps) {
  const { t } = useTranslation();
  const label = formatTermLabel(term);
  const zh = term.zh?.trim() ?? "";
  const hasTranslation = Boolean(zh) && resolveTermKey(zh) !== resolveTermKey(term.en);
  const statusKey = hasTranslation
    ? null
    : CJK_PATTERN.test(term.en)
      ? "orchestrator.picker.translation.chineseOriginal"
      : ["artist", "work", "meta"].includes(term.category)
        ? "orchestrator.picker.translation.originalName"
        : "orchestrator.picker.translation.missing";
  return (
    <button
      type="button"
      aria-pressed={selected}
      title={[label, term.zh].filter(Boolean).join(" / ")}
      onClick={onToggle}
      data-testid={testId}
      className={`flex min-w-0 items-start gap-2.5 rounded-md border px-3 py-2 text-left transition-colors ${
        selected
          ? "border-primary/40 bg-primary/10 text-primary"
          : "border-transparent text-foreground hover:border-border hover:bg-muted/60"
      }`}
    >
      <span
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border ${
          selected ? "border-primary bg-primary text-primary-foreground" : "border-border"
        }`}
        aria-hidden="true"
      >
        {selected && <CheckIcon className="h-3 w-3" />}
      </span>
      <span
        className="min-w-0 flex-1 whitespace-normal"
        style={{ overflowWrap: "anywhere", wordBreak: "normal" }}
      >
        <span className="block text-xs leading-5">{label}</span>
        {hasTranslation && (
          <span
            className={`mt-0.5 block text-[11px] leading-4 ${
              selected ? "text-primary/70" : "text-muted-foreground"
            }`}
          >
            {zh}
          </span>
        )}
        {statusKey && (
          <span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground/70">
            {t(statusKey)}
          </span>
        )}
        {hint && (
          <span className="mt-0.5 block text-[10px] text-muted-foreground/80">{hint}</span>
        )}
      </span>
    </button>
  );
}