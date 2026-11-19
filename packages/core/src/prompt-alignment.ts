import type {
  PromptAlignment,
  PromptAlignmentRow,
  PromptAlignmentSegment,
} from "@prompthub/shared/types";

/**
 * Sentence splitting for the side-by-side comparison.
 *
 * This is deliberately deterministic: the comparison must stay stable between
 * runs and must work without an LLM, so no model output is trusted for pairing.
 */
const SENTENCE_BREAK = /(?<=[。！？!?；;])|\r?\n+/;

const MATCH_THRESHOLD = 0.18;

export function splitPromptSentences(text: string): string[] {
  return text
    .split(SENTENCE_BREAK)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function tokenSet(text: string): Set<string> {
  const normalized = text.toLowerCase();
  const tokens = new Set<string>();
  for (const word of normalized.match(/[a-z0-9]+/g) ?? []) {
    tokens.add(word);
  }
  const cjk = normalized.replace(/[^\u4e00-\u9fff]/g, "");
  for (let index = 0; index < cjk.length - 1; index += 1) {
    tokens.add(cjk.slice(index, index + 2));
  }
  return tokens;
}

function overlapScore(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) {
    if (right.has(token)) shared += 1;
  }
  return shared / Math.min(left.size, right.size);
}

function segmentsOf(
  sentences: string[],
  prefix: "l" | "r",
): PromptAlignmentSegment[] {
  return sentences.map((text, index) => ({ id: `${prefix}${index}`, text }));
}

/**
 * Pairs source sentences with generated sentences.
 *
 * Overlap matching works while the rewrite keeps the original wording
 * (expansion, controlled random). When a pass rewrites the sentences
 * completely, overlap collapses, so index pairing is used instead: that is the
 * common case for polish/edit modes where sentence counts stay stable.
 */
export function buildPromptAlignment(
  source: string,
  generated: string,
): PromptAlignment {
  const sourceSegments = segmentsOf(splitPromptSentences(source ?? ""), "l");
  const generatedSegments = segmentsOf(
    splitPromptSentences(generated ?? ""),
    "r",
  );
  if (sourceSegments.length === 0 || generatedSegments.length === 0) {
    return {
      leftSegments: sourceSegments,
      rightSegments: generatedSegments,
      rows: [],
      method: "none",
    };
  }

  const overlapPairs = matchByOverlap(sourceSegments, generatedSegments);
  const baseline = Math.min(sourceSegments.length, generatedSegments.length);
  const useOverlap = overlapPairs.size >= Math.max(1, Math.ceil(baseline * 0.34));
  const leftToRight = useOverlap
    ? overlapPairs
    : new Map(
        Array.from({ length: baseline }, (_, index) => [index, index] as const),
      );

  const generatedToSource = new Map<number, number>();
  for (const [leftIndex, rightIndex] of leftToRight) {
    generatedToSource.set(rightIndex, leftIndex);
  }

  const rows: PromptAlignmentRow[] = [];
  let leftCursor = 0;
  for (let rightIndex = 0; rightIndex < generatedSegments.length; rightIndex += 1) {
    const linkedLeft = generatedToSource.get(rightIndex);
    if (linkedLeft !== undefined) {
      while (leftCursor < linkedLeft) {
        const segment = sourceSegments[leftCursor];
        if (!leftToRight.has(leftCursor)) {
          rows.push({
            id: `row-${segment.id}`,
            leftId: segment.id,
            rightId: null,
            isNew: false,
          });
        }
        leftCursor += 1;
      }
    }
    const generatedSegment = generatedSegments[rightIndex];
    rows.push({
      id: `row-${generatedSegment.id}`,
      leftId:
        linkedLeft === undefined ? null : sourceSegments[linkedLeft].id,
      rightId: generatedSegment.id,
      isNew: linkedLeft === undefined,
    });
    if (linkedLeft !== undefined) {
      leftCursor = Math.max(leftCursor, linkedLeft + 1);
    }
  }
  while (leftCursor < sourceSegments.length) {
    const segment = sourceSegments[leftCursor];
    if (!leftToRight.has(leftCursor)) {
      rows.push({
        id: `row-${segment.id}`,
        leftId: segment.id,
        rightId: null,
        isNew: false,
      });
    }
    leftCursor += 1;
  }

  return {
    leftSegments: sourceSegments,
    rightSegments: generatedSegments,
    rows,
    method: "sentence-match",
  };
}

function matchByOverlap(
  sourceSegments: PromptAlignmentSegment[],
  generatedSegments: PromptAlignmentSegment[],
): Map<number, number> {
  const sourceSets = sourceSegments.map((segment) => tokenSet(segment.text));
  const generatedSets = generatedSegments.map((segment) => tokenSet(segment.text));
  const pairs = new Map<number, number>();
  let cursor = 0;
  for (let leftIndex = 0; leftIndex < sourceSegments.length; leftIndex += 1) {
    let bestIndex = -1;
    let bestScore = MATCH_THRESHOLD;
    for (let rightIndex = cursor; rightIndex < generatedSegments.length; rightIndex += 1) {
      const score = overlapScore(sourceSets[leftIndex], generatedSets[rightIndex]);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = rightIndex;
      }
    }
    if (bestIndex >= 0) {
      pairs.set(leftIndex, bestIndex);
      cursor = bestIndex + 1;
    }
  }
  return pairs;
}
