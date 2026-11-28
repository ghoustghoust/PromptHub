import { useTranslation } from "react-i18next";
import { parseStoryboardRows } from "@prompthub/core/prompt-storyboard-shape";

const COLUMNS = ["shot", "size", "angle", "movement", "visual", "duration"] as const;

/**
 * Reads the six-column storyboard text into a table. Display only: the text the
 * model produced is never rewritten, and prose results render nothing.
 */
export function PromptStoryboardTableView({ text }: { text: string }) {
  const { t } = useTranslation();
  const rows = parseStoryboardRows(text);
  if (rows.length === 0) return null;
  return (
    <section className="space-y-2" data-testid="orchestrator-storyboard-table">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-xs font-semibold text-muted-foreground">
          {t("orchestrator.storyboardTable.title", { count: rows.length })}
        </h4>
        <span className="text-[11px] text-muted-foreground">
          {t("orchestrator.storyboardTable.hint")}
        </span>
      </div>
      <div className="min-w-0 overflow-x-auto rounded-lg border border-border/70">
        <table className="w-full border-collapse text-[11px]">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              {COLUMNS.map((column) => (
                <th
                  key={column}
                  scope="col"
                  className="whitespace-nowrap px-2 py-1 text-left font-medium"
                >
                  {t(`orchestrator.storyboardTable.columns.${column}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.number}
                className="border-t border-border/50 align-top"
                data-testid={`orchestrator-storyboard-row-${row.number}`}
              >
                {COLUMNS.map((column, index) => (
                  <td
                    key={column}
                    className={
                      column === "visual"
                        ? "min-w-[14rem] whitespace-pre-wrap break-words px-2 py-1"
                        : "whitespace-nowrap px-2 py-1"
                    }
                  >
                    {row.fields[index] ?? "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}