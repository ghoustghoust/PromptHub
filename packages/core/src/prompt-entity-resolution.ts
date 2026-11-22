import type { PromptVocabDB } from "@prompthub/db";
import {
  normalizeEntityKey,
  splitEntityName,
  type SplitEntityName,
} from "@prompthub/shared/utils/prompt-entity-key";
import type {
  PromptEntityCandidate,
  PromptEntityMention,
  PromptEntityResolution,
} from "@prompthub/shared/types";

const MAX_MENTIONS = 12;
const MAX_LOOKUP_KEYS = 500;
const MAX_CANDIDATES = 5;

const AT_WORD = /@[A-Za-z0-9][A-Za-z0-9'’._-]*/g;
const ASCII_WORD = /[A-Za-z0-9][A-Za-z0-9'’._-]*/g;
const QUALIFIED_NAME =
  /([A-Za-z0-9][A-Za-z0-9'’._-]*(?:\s+[A-Za-z0-9][A-Za-z0-9'’._-]*){0,3})\s*\(([^()\n]{1,60})\)/g;
const QUOTED = /"([^"\n]{2,60})"/g;
const CJK_RUN = /[\u3400-\u9fff]{2,}/g;
const MAX_GRAM = 4;
const MAX_CJK_WINDOW = 6;

interface ScannedMention extends PromptEntityMention {
  key: string;
}

export interface ResolvePromptEntitiesOptions {
  vocabulary: PromptVocabDB;
  prompt: string;
  maxMentions?: number;
}

interface AliasRow {
  termId: string;
  category: string;
  subcategory: string | null;
  en: string;
  zh: string | null;
  series: string | null;
  validationStatus: string;
}

interface IdentityGroup {
  identityKey: string;
  rows: AliasRow[];
}

function overlaps(left: { start: number; end: number }, right: { start: number; end: number }): boolean {
  return left.start < right.end && right.start < left.end;
}

function insideAny(mention: { start: number; end: number }, spans: Array<{ start: number; end: number }>): boolean {
  return spans.some((span) => mention.start >= span.start && mention.end <= span.end);
}

/** `@name` and quoted names are explicit identity markers. */
function explicitMentions(prompt: string): ScannedMention[] {
  const mentions: ScannedMention[] = [];
  for (const match of prompt.matchAll(AT_WORD)) {
    if (match.index === undefined) continue;
    const text = match[0];
    mentions.push({
      text,
      start: match.index,
      end: match.index + text.length,
      signal: "at-prefix",
      key: normalizeEntityKey(text),
    });
  }
  // `ganyu (genshin impact)` is one identity, not the separate words `ganyu`
  // and `genshin impact`; keep the qualified form as its own mention.
  for (const match of prompt.matchAll(QUALIFIED_NAME)) {
    if (match.index === undefined) continue;
    const text = match[0];
    mentions.push({
      text,
      start: match.index,
      end: match.index + text.length,
      signal: "series-qualified",
      key: normalizeEntityKey(text),
    });
  }
  for (const match of prompt.matchAll(QUOTED)) {
    const inner = match[1] ?? "";
    const raw = match[0];
    if (match.index === undefined || !inner.trim()) continue;
    const start = match.index + raw.indexOf(inner);
    mentions.push({
      text: inner,
      start,
      end: start + inner.length,
      signal: "quoted",
      key: normalizeEntityKey(inner),
    });
  }
  return mentions.filter((mention) => mention.key.length > 0);
}

/**
 * Builds contiguous ASCII n-grams (one to four words) and sliding CJK windows.
 * Only spans that are separated by whitespace/punctuation count, so `blue hair`
 * stays a candidate but `bluehair` does not pretend to be one.
 */
function dictionaryMentions(prompt: string, blocked: Array<{ start: number; end: number }>): ScannedMention[] {
  const mentions: ScannedMention[] = [];
  const words: Array<{ text: string; start: number; end: number }> = [];
  for (const match of prompt.matchAll(ASCII_WORD)) {
    if (match.index === undefined) continue;
    const word = { text: match[0], start: match.index, end: match.index + match[0].length };
    if (!insideAny(word, blocked)) words.push(word);
  }
  for (let index = 0; index < words.length; index += 1) {
    let end = words[index].end;
    for (let size = 1; size <= MAX_GRAM && index + size <= words.length; size += 1) {
      if (size > 1) {
        const previous = words[index + size - 2];
        const current = words[index + size - 1];
        const gap = prompt.slice(previous.end, current.start);
        if (!/^[ \t]+$/.test(gap)) break;
        end = current.end;
      }
      const text = prompt.slice(words[index].start, end);
      const key = normalizeEntityKey(text);
      if (!key) continue;
      mentions.push({ text, start: words[index].start, end, signal: "alias", key });
    }
  }
  for (const match of prompt.matchAll(CJK_RUN)) {
    if (match.index === undefined) continue;
    const run = match[0];
    const base = match.index;
    for (let size = 2; size <= MAX_CJK_WINDOW && size <= run.length; size += 1) {
      for (let offset = 0; offset + size <= run.length; offset += 1) {
        const span = { start: base + offset, end: base + offset + size };
        if (insideAny(span, blocked)) continue;
        const text = run.slice(offset, offset + size);
        const key = normalizeEntityKey(text);
        if (!key) continue;
        mentions.push({ text, start: span.start, end: span.end, signal: "cjk", key });
      }
    }
  }
  return mentions;
}

function uniqueKeys(mentions: ScannedMention[]): string[] {
  const keys = new Set<string>();
  for (const mention of mentions) {
    if (keys.size >= MAX_LOOKUP_KEYS) break;
    keys.add(mention.key);
  }
  return [...keys];
}

function identityKey(row: AliasRow): string {
  const split: SplitEntityName = splitEntityName(row.en);
  return [
    row.category,
    normalizeEntityKey(split.head),
    normalizeEntityKey(split.qualifier ?? ""),
  ].join("\0");
}

function groupIdentities(rows: AliasRow[]): IdentityGroup[] {
  const groups = new Map<string, IdentityGroup>();
  for (const row of rows) {
    const key = identityKey(row);
    const group = groups.get(key);
    if (group) group.rows.push(row);
    else groups.set(key, { identityKey: key, rows: [row] });
  }
  return [...groups.values()];
}

export type EntityAliasRow = AliasRow;

/**
 * Collapses stored rows into distinct identities. A bundle row and its
 * name-only twin share one identity; appearance stays out of the candidate.
 */
export function entityCandidates(rows: EntityAliasRow[]): PromptEntityCandidate[] {
  return groupIdentities(rows)
    .map(candidateFrom)
    .sort((left, right) => {
      const bundleRank = Number(left.hasAppearanceBundle) - Number(right.hasAppearanceBundle);
      if (bundleRank !== 0) return bundleRank;
      return left.displayName.localeCompare(right.displayName);
    });
}

/** A bare lowercase-ish word can also be an ordinary noun (`dusk`). */
function isSinglePlainToken(text: string): boolean {
  const trimmed = text.trim();
  return /^[A-Za-z0-9'’._-]+$/.test(trimmed);
}

function preferredRow(rows: AliasRow[]): AliasRow {
  return rows
    .slice()
    .sort((left, right) => {
      const bundleRank = Number(left.en.includes(",")) - Number(right.en.includes(","));
      if (bundleRank !== 0) return bundleRank;
      const validatedRank =
        Number(right.validationStatus === "validated") -
        Number(left.validationStatus === "validated");
      if (validatedRank !== 0) return validatedRank;
      return left.termId.localeCompare(right.termId);
    })[0];
}

function candidateFrom(group: IdentityGroup): PromptEntityCandidate {
  const best = preferredRow(group.rows);
  const split = splitEntityName(best.en);
  return {
    identityKey: group.identityKey,
    displayName: split.qualifier
      ? `${split.head} (${split.qualifier})`
      : split.head,
    category: best.category,
    subcategory: best.subcategory,
    series: best.series ?? split.qualifier,
    zh: best.zh,
    termIds: group.rows.map((row) => row.termId),
    hasAppearanceBundle: group.rows.some((row) => row.en.includes(",")),
    validationStatus: best.validationStatus as PromptEntityCandidate["validationStatus"],
  };
}

/**
 * Resolves named identities with exact normalized keys only. A mention either
 * pins one identity, lists candidates, or stays unresolved; it is never
 * "completed" from appearance similarity or a fuzzy prefix.
 */
export function resolvePromptEntities(
  options: ResolvePromptEntitiesOptions,
): PromptEntityResolution[] {
  const prompt = options.prompt;
  if (!prompt.trim()) return [];
  const limit = options.maxMentions ?? MAX_MENTIONS;
  const explicit = explicitMentions(prompt);
  const blocked = explicit.map((mention) => ({ start: mention.start, end: mention.end }));
  const scanned = [...explicit, ...dictionaryMentions(prompt, blocked)];
  const keys = uniqueKeys(scanned);
  if (keys.length === 0) return [];
  const matches = options.vocabulary.resolveTermAliases(keys);
  if (matches.length === 0) return [];

  const byKey = new Map<string, AliasRow[]>();
  for (const match of matches) {
    const list = byKey.get(match.aliasKey) ?? [];
    list.push({
      termId: match.termId,
      category: match.category,
      subcategory: match.subcategory,
      en: match.en,
      zh: match.zh,
      series: match.series,
      validationStatus: match.validationStatus,
    });
    byKey.set(match.aliasKey, list);
  }

  // Longest non-overlapping mentions win: "hatsune miku" hides "hatsune" only
  // when both are real keys, which is exactly the behavior we want.
  const hit = scanned
    .filter((mention) => byKey.has(mention.key))
    .sort((left, right) => {
      const lengthDelta = right.text.length - left.text.length;
      if (lengthDelta !== 0 && overlaps(left, right)) return lengthDelta;
      return left.start - right.start;
    });
  const accepted: ScannedMention[] = [];
  for (const mention of hit) {
    if (accepted.some((existing) => overlaps(existing, mention))) continue;
    accepted.push(mention);
    if (accepted.length >= limit) break;
  }

  const resolutions = accepted
    .sort((left, right) => left.start - right.start)
    .map((mention): PromptEntityResolution | null => {
      const candidates = entityCandidates(byKey.get(mention.key) ?? []).slice(0, MAX_CANDIDATES);
      const base = {
        mention: { text: mention.text, start: mention.start, end: mention.end, signal: mention.signal },
        candidates,
      };
      const only = candidates.length === 1 ? candidates[0] : undefined;
      if (only) {
        // `dusk garden` must not pin the Arknights character `dusk`: a plain
        // single token has no identity signal, so it stays as written.
        if (mention.signal === "alias" && isSinglePlainToken(mention.text)) {
          return null;
        }
        return {
          ...base,
          status: "resolved" as const,
          termId: only.termIds[0],
          displayName: only.displayName,
          reason: `Resolved by ${mention.signal} alias lookup.`,
        };
      }
      if (candidates.length === 0) {
        return {
          ...base,
          status: "unresolved" as const,
          reason: `No alias row matched "${mention.text}".`,
        };
      }
      return {
        ...base,
        status: "ambiguous" as const,
        reason: `"${mention.text}" matches ${candidates.length} distinct identities; choose one instead of guessing.`,
      };
    })
    .filter((resolution): resolution is PromptEntityResolution => resolution !== null);
  return resolutions;
}
