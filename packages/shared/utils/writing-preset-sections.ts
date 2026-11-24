import type { PromptWritingPresetSection } from "../types/prompt-writing-preset";
import { estimatePromptTokens } from "@prompthub/shared/utils/prompt-token-estimate";

export interface WritingPresetSectionContent extends PromptWritingPresetSection {
  content: string;
}

const MAX_SECTIONS = 200;

function normalizeSectionText(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\u00a0]+/g, " ")
    .replace(/ {2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9\u3400-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "section";
}

function toSection(index: number, title: string, content: string): WritingPresetSectionContent {
  const body = content.trim();
  return {
    id: `${index + 1}-${slugify(title)}`,
    title: title.trim().slice(0, 120) || `Section ${index + 1}`,
    content: body,
    charCount: body.length,
    tokenEstimate: estimatePromptTokens(body),
  };
}

/**
 * Splits a writing document on Markdown headings. Documents without headings
 * stay as one whole-document section instead of being cut at arbitrary
 * paragraphs. Ids depend on order and title, so stale ids after an edit must be
 * treated as "not selected" rather than as an error.
 */
export function splitWritingPresetSectionsWithContent(
  text: string,
): WritingPresetSectionContent[] {
  const normalized = normalizeSectionText(text);
  if (!normalized) return [];
  const matches = [...normalized.matchAll(/^#{1,6}\s+(.+)$/gm)];
  if (matches.length === 0) {
    return [toSection(0, "全文", normalized)];
  }

  const rawSections: Array<{ title: string; content: string }> = [];
  const preface = normalized.slice(0, matches[0].index ?? 0).trim();
  if (preface) rawSections.push({ title: "概述", content: preface });
  matches.forEach((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = index + 1 < matches.length
      ? matches[index + 1].index ?? normalized.length
      : normalized.length;
    const content = normalized.slice(start, end).trim();
    if (!content) return;
    rawSections.push({ title: match[1] ?? "", content });
  });
  if (rawSections.length === 0) {
    return [toSection(0, "全文", normalized)];
  }
  const merged = rawSections.length > MAX_SECTIONS
    ? [
        ...rawSections.slice(0, MAX_SECTIONS - 1),
        {
          title: "其余内容",
          content: rawSections
            .slice(MAX_SECTIONS - 1)
            .map((item) => `## ${item.title}\n${item.content}`)
            .join("\n\n"),
        },
      ]
    : rawSections;
  return merged.map((item, index) => toSection(index, item.title, item.content));
}

/** Metadata-only projection for list/detail payloads. */
export function splitWritingPresetSections(text: string): PromptWritingPresetSection[] {
  return splitWritingPresetSectionsWithContent(text).map((section) => ({
    id: section.id,
    title: section.title,
    charCount: section.charCount,
    tokenEstimate: section.tokenEstimate,
  }));
}

/**
 * Rebuilds the injectable text from the selected sections. Selecting every
 * section returns the stored text untouched; partial selections get a heading
 * per section so the model can tell the blocks apart.
 */
export function assembleWritingLayerText(
  text: string,
  sectionIds: readonly string[],
): string {
  const sections = splitWritingPresetSectionsWithContent(text);
  if (sections.length === 0) return "";
  const selected = sections.filter((section) => sectionIds.includes(section.id));
  if (selected.length === 0) return "";
  if (selected.length === sections.length) return normalizeSectionText(text);
  return selected
    .map((section) =>
      section.title === "全文" || section.title === "概述"
        ? section.content
        : `## ${section.title}\n${section.content}`,
    )
    .join("\n\n");
}
