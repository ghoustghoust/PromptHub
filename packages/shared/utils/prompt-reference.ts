import type { PromptReferenceStyleInput } from "../types/prompt-orchestrator";

/**
 * Compact reference-layer block shared by Core, the budget preview and the UI,
 * so the reserved token count always matches what the model receives.
 */
export function buildReferenceStyleText(items: PromptReferenceStyleInput[]): string {
  if (items.length === 0) return "";
  const blocks = items.map((item) => {
    const name = item.nameEn?.trim() ? `${item.nameZh} / ${item.nameEn.trim()}` : item.nameZh;
    const details = [
      item.summary.trim(),
      item.palette.length > 0 ? `palette ${item.palette.join(", ")}` : "",
      item.style?.lighting ? `light ${item.style.lighting}` : "",
      item.style?.framing ? `framing ${item.style.framing}` : "",
    ].filter(Boolean).join(" · ");
    return `- ${name} (${item.category}): ${details}`;
  });
  return [
    "Visual style references: use their palette, light and composition as direction. Do not quote this block or pad the prompt with director names.",
    ...blocks,
  ].join("\n");
}