import path from "node:path";
import type { PromptWritingPresetSection } from "@prompthub/shared/types";
import { estimatePromptTokens } from "@prompthub/shared/utils/prompt-token-estimate";

export const MAX_WRITING_PRESET_CHARS = 200_000;
const MAX_SECTIONS = 200;

export type WritingPresetFormat = "text" | "markdown" | "html";

export interface WritingPresetExtraction {
  format: WritingPresetFormat;
  /** Extracted body text. HTML is never stored or injected as markup. */
  text: string;
  suggestedName: string;
}

const HTML_EXTENSIONS = new Set([".html", ".htm", ".xhtml"]);
const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown", ".mdx"]);
const TEXT_EXTENSIONS = new Set([".txt", ".text", ".log", ".csv", ""]);

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "\u2014",
  ndash: "\u2013",
  hellip: "\u2026",
  lsquo: "\u2018",
  rsquo: "\u2019",
  ldquo: "\u201c",
  rdquo: "\u201d",
  middot: "\u00b7",
  bull: "\u2022",
  times: "\u00d7",
  deg: "\u00b0",
};

export function detectWritingPresetFormat(fileName: string): WritingPresetFormat {
  const extension = path.extname(fileName).toLowerCase();
  if (HTML_EXTENSIONS.has(extension)) return "html";
  if (MARKDOWN_EXTENSIONS.has(extension)) return "markdown";
  if (TEXT_EXTENSIONS.has(extension)) return "text";
  throw new Error(
    `Unsupported writing document type: ${extension || "(none)"}. Use .txt, .md, .htm or .html.`,
  );
}

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith("#")) {
      const hex = body[1]?.toLowerCase() === "x";
      const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

function normalizeText(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\u00a0]+/g, " ")
    .replace(/ {2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function htmlTitle(html: string): string {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!match) return "";
  return normalizeText(decodeEntities(stripTags(match[1] ?? ""))).slice(0, 120);
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ");
}

/** Turns a saved web page into readable body text; markup never survives. */
function htmlToText(html: string): string {
  let body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|svg|noscript|template|iframe|canvas)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(nav|footer|aside)\b[\s\S]*?<\/\1>/gi, " ");
  const main = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(body);
  if (main?.[1]) {
    body = main[1];
  } else {
    const article = /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(body);
    const bodyMatch = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(body);
    body = article?.[1] ?? bodyMatch?.[1] ?? body;
  }
  const withHeadings = body
    // Keep heading text as markdown headings so section splitting stays honest.
    .replace(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_match, _level, inner: string) => {
      const title = normalizeText(decodeEntities(stripTags(inner)));
      return title ? `\n\n## ${title}\n\n` : "\n\n";
    })
    .replace(/<h[4-6]\b[^>]*>([\s\S]*?)<\/h[4-6]>/gi, (_match, inner: string) => {
      const title = normalizeText(decodeEntities(stripTags(inner)));
      return title ? `\n\n**${title}**\n\n` : "\n\n";
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|li|tr|blockquote|pre|table|ul|ol)>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "- ");
  return normalizeText(decodeEntities(stripTags(withHeadings)));
}

/**
 * Reads one local writing document. The result is the full extracted body so
 * the caller can preview it; nothing is shortened or written to the database
 * until the user saves an explicit compressed version.
 */
export function extractWritingPresetText(
  fileName: string,
  raw: string,
): WritingPresetExtraction {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error("The selected writing document is empty");
  }
  if (raw.includes("\0")) {
    throw new Error("The selected writing document is not a text file");
  }
  const format = detectWritingPresetFormat(fileName);
  const baseName = path.basename(fileName).replace(/\.[^.]+$/, "");
  const text = format === "html" ? htmlToText(raw) : normalizeText(raw);
  if (!text.trim()) {
    throw new Error("No readable body text was found in the selected document");
  }
  if (text.length > MAX_WRITING_PRESET_CHARS) {
    throw new Error(
      `Extracted text is ${text.length.toLocaleString("en-US")} characters, above the ${MAX_WRITING_PRESET_CHARS.toLocaleString("en-US")} limit. Split the document first.`,
    );
  }
  const suggestedName = (format === "html" ? htmlTitle(raw) : "").trim() || baseName.trim() || "Imported writing document";
  return { format, text, suggestedName: suggestedName.slice(0, 120) };
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9\u3400-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "section";
}

function toSection(index: number, title: string, content: string): PromptWritingPresetSection {
  const body = content.trim();
  return {
    id: `${index + 1}-${slugify(title)}`,
    title: title.trim().slice(0, 120) || `Section ${index + 1}`,
    charCount: body.length,
    tokenEstimate: estimatePromptTokens(body),
  };
}

/**
 * Splits a writing document on Markdown headings. Documents without headings
 * stay as one "whole document" section rather than being cut at arbitrary
 * paragraph boundaries. Section ids depend on order and title, so callers must
 * ignore ids they no longer find after an edit.
 */
export function splitWritingPresetSections(text: string): PromptWritingPresetSection[] {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  const headingPattern = /^#{1,6}\s+(.+)$/gm;
  const matches = [...normalized.matchAll(headingPattern)];
  if (matches.length === 0) {
    return [toSection(0, "全文", normalized)];
  }

  const rawSections: Array<{ title: string; content: string }> = [];
  const preface = normalized.slice(0, matches[0].index ?? 0).trim();
  if (preface) rawSections.push({ title: "概述", content: preface });
  matches.forEach((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index ?? normalized.length : normalized.length;
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
