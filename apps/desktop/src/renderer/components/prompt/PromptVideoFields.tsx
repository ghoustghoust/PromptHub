import { useTranslation } from "react-i18next";
import type {
  PromptOrchestrationMode,
  PromptVideoOrchestrationInput,
} from "@prompthub/shared/types";
import { Input } from "../ui/Input";
import { Textarea } from "../ui/Textarea";

interface PromptVideoFieldsProps {
  mode: PromptOrchestrationMode;
  value: PromptVideoOrchestrationInput;
  onChange: <K extends keyof PromptVideoOrchestrationInput>(
    key: K,
    value: PromptVideoOrchestrationInput[K],
  ) => void;
}

export function PromptVideoFields({ mode, value, onChange }: PromptVideoFieldsProps) {
  const { t } = useTranslation();
  const text = (key: "action" | "cameraMotion" | "lighting" | "audio" | "music" | "dialogue" | "referencePlan" | "beatTimestamps" | "continuity") => (
    <Textarea
      label={t(`orchestrator.video.${key}`)}
      value={value[key] ?? ""}
      onChange={(event) => onChange(key, event.target.value)}
      rows={key === "action" || key === "referencePlan" || key === "continuity" ? 3 : 2}
    />
  );
  return (
    <div className="space-y-3 rounded-lg border border-border/70 bg-muted/10 p-3">
      <div className="grid grid-cols-2 gap-3">
        <Input
          label={t("orchestrator.video.durationSeconds")}
          type="number"
          min={1}
          value={value.durationSeconds ?? 8}
          onChange={(event) => onChange("durationSeconds", Number(event.target.value))}
          variant="outlined"
        />
        <Input
          label={t("orchestrator.video.shotCount")}
          type="number"
          min={1}
          max={100}
          value={value.shotCount ?? (mode === "video-long" ? 6 : 1)}
          onChange={(event) => onChange("shotCount", Number(event.target.value))}
          variant="outlined"
        />
      </div>
      <Input
        label={t("orchestrator.video.style")}
        value={value.style ?? ""}
        onChange={(event) => onChange("style", event.target.value)}
        variant="outlined"
      />
      {text("action")}
      {(mode === "video-text" || mode === "video-frames" || mode === "video-long" || mode === "video-beat") && text("cameraMotion")}
      {(mode === "video-text" || mode === "video-frames" || mode === "video-long") && text("lighting")}
      {mode === "video-multi-reference" && text("referencePlan")}
      {mode === "video-long" && text("continuity")}
      {mode === "video-short-drama" && text("continuity")}
      {mode === "video-beat" && text("beatTimestamps")}
      {(mode === "video-short-drama" || mode === "video-text" || mode === "video-multi-reference") && text("dialogue")}
      {text("audio")}
      {text("music")}
      {mode === "video-beat" && (
        <p className="rounded-md border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-700 dark:text-yellow-300">
          {t("orchestrator.video.beatWarning")}
        </p>
      )}
    </div>
  );
}
