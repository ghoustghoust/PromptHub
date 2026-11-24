import type {
  PromptWritingLayerVariant,
  PromptWritingPreset,
  PromptWritingPresetSection,
} from "@prompthub/shared/types";
import { estimatePromptTokens } from "@prompthub/shared/utils/prompt-token-estimate";
import {
  assembleWritingLayerText,
  splitWritingPresetSectionsWithContent,
} from "@prompthub/shared/utils/writing-preset-sections";

export type WritingLayerMode = "preset" | "custom";

export interface WritingLayerSelection {
  mode: WritingLayerMode;
  presetId: string | null;
  variant: PromptWritingLayerVariant;
  sectionIds: string[];
}

export const EMPTY_WRITING_LAYER: WritingLayerSelection = {
  mode: "custom",
  presetId: null,
  variant: "compressed",
  sectionIds: [],
};

export function writingLayerSections(
  preset: PromptWritingPreset | null,
  variant: PromptWritingLayerVariant,
): PromptWritingPresetSection[] {
  if (!preset) return [];
  const source = variant === "original" ? preset.originalContent : preset.compressedContent;
  if (!source) return [];
  return splitWritingPresetSectionsWithContent(source).map((section) => ({
    id: section.id,
    title: section.title,
    charCount: section.charCount,
    tokenEstimate: section.tokenEstimate,
  }));
}

export function assemblePresetLayerText(
  preset: PromptWritingPreset | null,
  variant: PromptWritingLayerVariant,
  sectionIds: readonly string[],
): string {
  if (!preset) return "";
  const source = variant === "original" ? preset.originalContent : preset.compressedContent;
  if (!source) return "";
  return assembleWritingLayerText(source, sectionIds);
}

export function layerTokens(text: string): number {
  return estimatePromptTokens(text);
}

/** Merge persisted section ids with the current document; unknown ids are dropped. */
export function normalizeSectionIds(
  preset: PromptWritingPreset | null,
  variant: PromptWritingLayerVariant,
  sectionIds: readonly string[],
): string[] {
  const sections = writingLayerSections(preset, variant);
  if (sections.length === 0) return [];
  const known = new Set(sections.map((section) => section.id));
  const kept = sectionIds.filter((id) => known.has(id));
  return kept.length > 0 ? kept : sections.map((section) => section.id);
}
