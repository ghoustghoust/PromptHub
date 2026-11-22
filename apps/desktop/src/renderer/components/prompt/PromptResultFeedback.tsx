import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckIcon, ThumbsDownIcon, ThumbsUpIcon } from "lucide-react";
import type {
  PromptOrchestrationResult,
  PromptResultFeedbackReason,
  PromptResultRating,
} from "@prompthub/shared/types";
import { Button } from "../ui/Button";
import { Textarea } from "../ui/Textarea";

const REASONS: PromptResultFeedbackReason[] = [
  "intent-drift",
  "subject-wrong",
  "too-generic",
  "too-specific",
  "conflicting",
  "style-off",
  "format-broken",
  "other",
];

interface Props {
  result: PromptOrchestrationResult;
  sourcePrompt: string;
}

/**
 * Result-level feedback. It is stored as an observation only; it never edits a
 * term or promotes a validation status.
 */
export function PromptResultFeedback({ result, sourcePrompt }: Props) {
  const { t } = useTranslation();
  const [rating, setRating] = useState<PromptResultRating | null>(null);
  const [reasons, setReasons] = useState<PromptResultFeedbackReason[]>([]);
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setRating(null);
    setReasons([]);
    setNote("");
    setSaved(false);
    setError("");
  }, [result]);

  function toggleReason(reason: PromptResultFeedbackReason): void {
    setReasons((current) =>
      current.includes(reason)
        ? current.filter((entry) => entry !== reason)
        : [...current, reason]);
  }

  async function submit(): Promise<void> {
    if (!rating || busy) return;
    setBusy(true);
    setError("");
    try {
      const reply = await window.api.promptOrchestrator.submitFeedback({
        input: {
          prompt: sourcePrompt || undefined,
          mode: result.mode,
          skill: result.skill,
          guidanceMode: result.guidanceMode,
        },
        result,
        feedback: {
          rating,
          reasons,
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      });
      if (reply.ok === true) {
        setSaved(true);
      } else {
        setError(reply.error.message);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="space-y-2 rounded-lg border border-border p-3"
      aria-label={t("orchestrator.feedback.title")}
      data-testid="orchestrator-result-feedback"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-xs font-semibold">{t("orchestrator.feedback.title")}</h4>
        <span className="text-[11px] text-muted-foreground">{t("orchestrator.feedback.hint")}</span>
      </div>
      {saved ? (
        <p className="flex items-center gap-1.5 text-[11px] text-primary">
          <CheckIcon className="h-3.5 w-3.5" aria-hidden="true" />
          {t("orchestrator.feedback.saved")}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            {(["usable", "unusable"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={rating === value}
                onClick={() => setRating(value)}
                data-testid={`orchestrator-feedback-${value}`}
                className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                  rating === value
                    ? "border-primary/50 bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                {value === "usable" ? (
                  <ThumbsUpIcon className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <ThumbsDownIcon className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                {t(`orchestrator.feedback.${value}`)}
              </button>
            ))}
          </div>
          {rating && (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5" aria-label={t("orchestrator.feedback.reasonsLabel")}>
                {REASONS.map((reason) => (
                  <button
                    key={reason}
                    type="button"
                    aria-pressed={reasons.includes(reason)}
                    onClick={() => toggleReason(reason)}
                    data-testid={`orchestrator-feedback-reason-${reason}`}
                    className={`rounded-full border px-2 py-1 text-[11px] transition-colors ${
                      reasons.includes(reason)
                        ? "border-primary/50 bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {t(`orchestrator.feedback.reasons.${reason}`)}
                  </button>
                ))}
              </div>
              <Textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder={t("orchestrator.feedback.notePlaceholder")}
                rows={2}
                className="bg-muted/30 text-xs"
              />
              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => void submit()}>
                  {busy ? t("orchestrator.feedback.saving") : t("orchestrator.feedback.submit")}
                </Button>
                {error && <span className="text-[11px] text-destructive">{error}</span>}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}