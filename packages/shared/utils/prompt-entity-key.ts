/**
 * Identity keys for named-entity vocabulary (characters, artists, series).
 *
 * Imported libraries spell the same identity differently: `@wlop`, `wlop`,
 * `genderswap_\(mtf\)`, `((alphonse mucha))`, `ganyu (genshin impact)` and
 * `甘雨（原神）`. Entity lookup compares one normalized key instead of raw text,
 * mirroring `resolveTermKey` for ordinary terms. This module is pure text
 * policy so the importer, the DB backfill and core all share one rule.
 */

export type PromptDerivedAliasKind = "canonical" | "series_less" | "zh";

export interface PromptDerivedAlias {
  alias: string;
  key: string;
  kind: PromptDerivedAliasKind;
}

export interface SplitEntityName {
  /** Name without the series qualifier or the appended appearance list. */
  head: string;
  /** Series/game inside a trailing parenthesis such as `ganyu (genshin impact)`. */
  qualifier: string | null;
  /** Comma-separated attributes that follow the name in bundle rows. */
  attributes: string[];
}

const WEIGHT_PATTERN = /\(\s*([^()]+?)\s*:\s*-?\d+(?:\.\d+)?\s*\)/g;
const GENERIC_SUBCATEGORIES: ReadonlySet<string> = new Set(["对象", "身份"]);
const GENERIC_ASCII_HEADS = [
  /^(?:\d+\s*)?(?:girl|boy|girls|boys|others|solo|people|couple)$/,
  /^(?:anime|original|oc)\s+character$/,
  /^(?:girl|boy|man|woman|person|character|figure)$/,
];
/** Tags and placeholders that live in `character` without naming anyone. */
const GENERIC_CJK_HEADS = /^(?:动漫角色|原创角色|人物|角色|女孩|男孩|少女|少年|女性|男性|一位.*|.*(?:女孩|男孩|少女|少年|角色))$/;

function stripOuterParentheses(value: string): string {
  let text = value.trim();
  for (let guard = 0; guard < 3; guard += 1) {
    if (!text.startsWith("(") || !text.endsWith(")")) return text;
    let depth = 0;
    let wrapsWholeString = true;
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (char === "(") depth += 1;
      if (char === ")") depth -= 1;
      // The opening parenthesis must stay open until the final character,
      // otherwise the trailing pair belongs to a series qualifier, not emphasis.
      if (depth === 0 && index < text.length - 1) {
        wrapsWholeString = false;
        break;
      }
    }
    if (!wrapsWholeString || depth !== 0) return text;
    text = text.slice(1, -1).trim();
  }
  return text;
}

/** Splits `a, b, c` on commas that are not inside parentheses or brackets. */
function splitTopLevelCommas(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  for (const char of value) {
    if (char === "(" || char === "[") depth += 1;
    if (char === ")" || char === "]") depth = Math.max(0, depth - 1);
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

/**
 * One comparison key for an identity mention. Lowercases, normalizes
 * full-width punctuation, drops `@`, weight syntax, emphasis wrappers,
 * escapes, underscores and quotes.
 */
export function normalizeEntityKey(value: string): string {
  return stripOuterParentheses(
    value
      .normalize("NFKC")
      .replace(WEIGHT_PATTERN, "$1")
      .replace(/^[\s@]+/, "")
      .replace(/\\/g, "")
      .replace(/_+/g, " ")
      .replace(/["'“”„‟]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase(),
  );
}

/**
 * Splits a stored term into the identity head, an optional series qualifier and
 * the appearance attributes some bundle rows append after a comma. Bundle rows
 * must never be used whole: their tail is appearance, not identity.
 */
export function splitEntityName(value: string): SplitEntityName {
  const parts = splitTopLevelCommas(
    value.normalize("NFKC").replace(/\\([()])/g, "$1"),
  );
  let head = (parts[0] ?? "").replace(WEIGHT_PATTERN, "$1").replace(/^@+/, "").trim();
  let qualifier: string | null = null;
  if (head.endsWith(")")) {
    let depth = 0;
    for (let index = head.length - 1; index >= 0; index -= 1) {
      const char = head[index];
      if (char === ")") depth += 1;
      if (char === "(") {
        depth -= 1;
        if (depth === 0) {
          const inner = head.slice(index + 1, -1).trim();
          const outer = head.slice(0, index).trim();
          if (outer.length > 0 && inner.length > 0) {
            qualifier = inner;
            head = outer;
          }
          break;
        }
      }
    }
  }
  return {
    head: stripOuterParentheses(head).replace(/^[_\s]+|[_\s]+$/g, ""),
    qualifier,
    attributes: parts.slice(1),
  };
}

/**
 * Whether a stored row names someone. `character` also holds count tags
 * (`1girl`), placeholders and Chinese place names, so category alone is not an
 * identity signal.
 */
export function isNamedEntityTerm(term: {
  category: string;
  subcategory: string | null;
  en: string;
}): boolean {
  if (term.category !== "character" && term.category !== "artist") return false;
  if (term.subcategory !== null && GENERIC_SUBCATEGORIES.has(term.subcategory)) {
    return false;
  }
  const { head, qualifier } = splitEntityName(term.en);
  if (!head || !/[a-z\u3400-\u9fff]/i.test(head)) return false;
  const compact = head.replace(/\s+/g, "");
  if (compact.length < 2) return false;
  // Style/comic tags land in `character` with a generic Chinese translation
  // ("风格"), which would turn every such word into an identity mention.
  if (/^\d+koma$/i.test(compact) || /^\d{4}s$/i.test(compact)) return false;
  if (qualifier !== null && /^(?:style|medium|theme|meta|object)$/i.test(qualifier)) {
    return false;
  }
  if (GENERIC_CJK_HEADS.test(compact)) return false;
  const lower = head.toLowerCase();
  if (GENERIC_ASCII_HEADS.some((pattern) => pattern.test(lower))) return false;
  // Symbol-only artist rows (`!!`, `#b7282e`) and one-letter fragments are not
  // lookup keys; requiring three ASCII characters removes most danbooru noise.
  if (!/[\u3400-\u9fff]/.test(head) && compact.length < 3) return false;
  return true;
}

function isUsableKey(key: string): boolean {
  if (!/[a-z\u3400-\u9fff]/.test(key)) return false;
  return /[\u3400-\u9fff]/.test(key) ? key.length >= 2 : key.length >= 3;
}

/**
 * Deterministic aliases derived from one stored row. Curated aliases (common
 * abbreviations) are not invented here; they enter through the alias table.
 */
export function deriveEntityAliases(term: { en: string; zh: string | null }): PromptDerivedAlias[] {
  const aliases: PromptDerivedAlias[] = [];
  const seen = new Set<string>();
  const push = (alias: string | null, kind: PromptDerivedAliasKind): void => {
    if (!alias) return;
    const key = normalizeEntityKey(alias);
    if (!key || !isUsableKey(key)) return;
    const dedupe = `${kind}\0${key}`;
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    aliases.push({ alias, key, kind });
  };
  const { head, qualifier, attributes } = splitEntityName(term.en);
  push(term.en, "canonical");
  // A bundle row (`name (series), hair, horns`) and a name-only row must answer
  // the same identity key, otherwise the qualified mention only finds one of them.
  if (attributes.length > 0 || qualifier !== null) {
    push(qualifier ? `${head} (${qualifier})` : head, "canonical");
  }
  if (qualifier !== null) push(head, "series_less");
  if (term.zh) {
    const zhHead = splitEntityName(term.zh).head;
    push(term.zh, "zh");
    if (zhHead !== term.zh) push(zhHead, "zh");
  }
  return aliases;
}
