import { useTranslation } from "react-i18next";
import type { PromptOrchestrationResult } from "@prompthub/shared/types";
import { Textarea } from "../ui/Textarea";

export function PromptMossLayoutResultView({ result }: { result: PromptOrchestrationResult }) {
  const { t } = useTranslation();
  if (!result.layout) return null;
  const { draft, modelPrompt, characterBoxes } = result.layout;
  return (
    <div className="space-y-4" data-testid="moss-layout-result">
      <div className="flex flex-wrap gap-2 text-[11px]">
        <span className="rounded-md bg-muted px-2 py-1">
          {t("orchestrator.layout.targetCanvas")}: {draft.canvas.width} × {draft.canvas.height}
        </span>
        <span className="rounded-md bg-muted px-2 py-1">
          {t("orchestrator.layout.boxCount")}: {modelPrompt.items.length}
        </span>
        <span className="rounded-md bg-muted px-2 py-1">
          character_boxes: {characterBoxes.length > 0 ? characterBoxes.join(", ") : "—"}
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground">{t("orchestrator.layout.resultHint")}</p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground">
            {t("orchestrator.layout.initialJson")}
          </h4>
          <Textarea
            value={JSON.stringify(JSON.parse(result.initialPrompt), null, 2)}
            readOnly
            rows={20}
            className="bg-muted/30 font-mono text-[11px]"
            data-testid="layout-initial-json"
          />
        </div>
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground">
            {t("orchestrator.layout.finalJson")}
          </h4>
          <Textarea
            value={JSON.stringify(modelPrompt, null, 2)}
            readOnly
            rows={20}
            className="bg-muted/30 font-mono text-[11px]"
            data-testid="layout-final-json"
          />
        </div>
      </div>
    </div>
  );
}
