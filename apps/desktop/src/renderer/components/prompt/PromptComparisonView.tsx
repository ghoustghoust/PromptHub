import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { PlusIcon } from "lucide-react";
import type { PromptAlignment } from "@prompthub/shared/types";
import { Textarea } from "../ui/Textarea";

interface Props {
  source: string;
  generated: string;
  alignment?: PromptAlignment;
}

function SegmentText({ text }: { text: string }) {
  return <p className="whitespace-pre-wrap text-xs leading-relaxed">{text}</p>;
}

/**
 * Side-by-side source/generated comparison. Selecting a generated sentence
 * highlights the source sentence it came from, the way a translation tool does.
 */
export function PromptComparisonView({ source, generated, alignment }: Props) {
  const { t } = useTranslation();
  const [activeLeftId, setActiveLeftId] = useState<string | null>(null);

  const texts = useMemo(() => {
    const map = new Map<string, string>();
    for (const segment of alignment?.leftSegments ?? []) {
      map.set(segment.id, segment.text);
    }
    for (const segment of alignment?.rightSegments ?? []) {
      map.set(segment.id, segment.text);
    }
    return map;
  }, [alignment]);

  const usable =
    alignment !== undefined &&
    alignment.method === "sentence-match" &&
    alignment.rows.length > 0;

  if (!usable) {
    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground">
            {t("orchestrator.sourceLabel")}
          </h4>
          <Textarea value={source} readOnly rows={10} className="bg-muted/30" />
        </div>
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground">
            {t("orchestrator.generatedLabel")}
          </h4>
          <Textarea value={generated} readOnly rows={10} className="bg-muted/30" />
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border" data-testid="orchestrator-comparison">
      <div className="grid grid-cols-2 border-b border-border bg-muted/40 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <div className="border-r border-border px-3 py-2">
          {t("orchestrator.sourceLabel")}
        </div>
        <div className="px-3 py-2">{t("orchestrator.generatedLabel")}</div>
      </div>
      <div className="divide-y divide-border/70">
        {alignment.rows.map((row) => {
          const leftText = row.leftId ? texts.get(row.leftId) : undefined;
          const rightText = row.rightId ? texts.get(row.rightId) : undefined;
          const active = row.leftId !== null && row.leftId === activeLeftId;
          return (
            <div
              key={row.id}
              className={`grid grid-cols-2 transition-colors ${active ? "bg-primary/5" : ""}`}
            >
              <div
                className={`border-r border-border px-3 py-2 ${
                  active ? "text-foreground" : "text-muted-foreground"
                } ${active ? "font-medium" : ""}`}
                data-active={active ? "true" : undefined}
              >
                {leftText !== undefined ? (
                  <SegmentText text={leftText} />
                ) : row.isNew ? (
                  <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    <PlusIcon className="h-3 w-3" aria-hidden="true" />
                    {t("orchestrator.alignmentNew")}
                  </span>
                ) : (
                  <span className="text-[11px] text-muted-foreground/60">
                    {t("orchestrator.alignmentContinuation")}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() =>
                  setActiveLeftId((current) =>
                    row.leftId !== null && current === row.leftId
                      ? null
                      : row.leftId,
                  )
                }
                className="px-3 py-2 text-left text-foreground hover:bg-muted/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
              >
                {rightText !== undefined && <SegmentText text={rightText} />}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
