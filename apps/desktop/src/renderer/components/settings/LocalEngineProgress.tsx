import { useTranslation } from "react-i18next";
import type {
  LocalLlamaEnginePhase,
  LocalLlamaEventLoopDelay,
  LocalLlamaStartStage,
} from "@prompthub/shared/types";

const STAGES: Array<Exclude<LocalLlamaStartStage, "idle">> = [
  "spawn",
  "load-weights",
  "health-check",
];

/**
 * Staged progress for engine startup. llama-server does not report a trustworthy
 * percentage, so this shows which stage is running and how long it has taken
 * instead of inventing a bar position.
 */
export function LocalEngineProgress({
  phase,
  stage = "spawn",
  startedAt,
  eventLoopDelayMs,
}: {
  phase: LocalLlamaEnginePhase;
  stage?: LocalLlamaStartStage;
  startedAt: number | null;
  eventLoopDelayMs?: LocalLlamaEventLoopDelay | null;
}) {
  const { t } = useTranslation();
  const activeIndex = Math.max(0, STAGES.indexOf(stage === "idle" ? "spawn" : stage));
  const elapsedSeconds = startedAt ? Math.max(0, Math.round((Date.now() - startedAt) / 1000)) : 0;
  const starting = phase === "starting";

  return (
    <div className="space-y-1.5" data-testid="local-engine-progress">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <span className="font-medium text-foreground">
          {starting ? t(`localModel.stage.${stage === "idle" ? "spawn" : stage}`) : t(`localModel.phase.${phase}`)}
        </span>
        {starting && (
          <span className="text-muted-foreground">
            {t("localModel.elapsed", { seconds: elapsedSeconds })}
          </span>
        )}
      </div>
      <div className="grid grid-cols-3 gap-1" aria-hidden="true">
        {STAGES.map((value, index) => (
          <div
            key={value}
            className={`h-1.5 rounded-full transition-colors ${
              starting && index <= activeIndex ? "bg-primary" : "bg-muted"
            }`}
          />
        ))}
      </div>
      {starting && (
        <p className="text-[11px] text-muted-foreground">{t("localModel.progressHint")}</p>
      )}
      {eventLoopDelayMs && (
        <p className="text-[11px] text-muted-foreground" data-testid="local-engine-event-loop">
          {t("localModel.eventLoopDelay", {
            p50: eventLoopDelayMs.p50,
            p95: eventLoopDelayMs.p95,
          })}
        </p>
      )}
    </div>
  );
}
