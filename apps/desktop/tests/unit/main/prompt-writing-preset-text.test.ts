import { describe, expect, it } from "vitest";
import {
  detectWritingPresetFormat,
  extractWritingPresetText,
  MAX_WRITING_PRESET_CHARS,
  splitWritingPresetSections,
} from "../../../src/main/services/prompt-writing-preset-text";

describe("writing preset text extraction", () => {
  it("detects supported document formats", () => {
    expect(detectWritingPresetFormat("guide.txt")).toBe("text");
    expect(detectWritingPresetFormat("GUIDE.MD")).toBe("markdown");
    expect(detectWritingPresetFormat("saved-page.htm")).toBe("html");
    expect(() => detectWritingPresetFormat("guide.docx")).toThrow(
      "Unsupported writing document type",
    );
  });

  it("keeps only body text from a saved page and turns headings into sections", () => {
    const html = `<!doctype html><html><head>
      <title>Krea 2 官方生图规范</title>
      <style>.nav{color:red}</style>
      <script>window.tracker = "noise";</script>
    </head><body>
      <nav>should be dropped</nav>
      <main>
        <h1>Caption</h1>
        <p>Use coherent prose &amp; preserve exact text.</p>
        <h2>Tags</h2>
        <p>Keep artist names without the @ prefix.</p>
        <svg><text>decorative</text></svg>
      </main>
      <footer>should also be dropped</footer>
    </body></html>`;

    const extracted = extractWritingPresetText("krea2.htm", html);
    expect(extracted.format).toBe("html");
    expect(extracted.suggestedName).toBe("Krea 2 官方生图规范");
    expect(extracted.text).toContain("## Caption");
    expect(extracted.text).toContain("Use coherent prose & preserve exact text.");
    expect(extracted.text).not.toMatch(/<[a-z/]/i);
    expect(extracted.text).not.toContain("tracker");
    expect(extracted.text).not.toContain("should be dropped");
    expect(extracted.text).not.toContain("decorative");

    const sections = splitWritingPresetSections(extracted.text);
    expect(sections.map((section) => section.title)).toEqual(["Caption", "Tags"]);
    expect(sections[1].tokenEstimate).toBeGreaterThan(0);
  });

  it("splits Markdown headings and keeps the preface as an overview section", () => {
    const sections = splitWritingPresetSections(
      ["Intro line.", "", "## Alpha", "First body.", "", "## Beta", "Second body."].join("\n"),
    );
    expect(sections.map((section) => section.title)).toEqual(["概述", "Alpha", "Beta"]);
    expect(sections[0].charCount).toBe("Intro line.".length);
    expect(new Set(sections.map((section) => section.id)).size).toBe(3);
  });

  it("keeps documents without headings as a single whole-text section", () => {
    const sections = splitWritingPresetSections("Only prose.\n\nNo headings here.");
    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({ title: "全文", charCount: 30 });
  });

  it("normalizes line endings and rejects unusable input", () => {
    const extracted = extractWritingPresetText("notes.txt", "a\r\n\r\n\r\nb\r\n");
    expect(extracted.text).toBe("a\n\nb");
    expect(() => extractWritingPresetText("empty.txt", "   ")).toThrow("empty");
    expect(() => extractWritingPresetText("binary.txt", "a\0b")).toThrow(
      "not a text file",
    );
    expect(() => extractWritingPresetText("page.htm", "<html><body><script>x</script></body></html>")).toThrow(
      "No readable body text",
    );
    expect(() =>
      extractWritingPresetText("huge.txt", "x".repeat(MAX_WRITING_PRESET_CHARS + 1)),
    ).toThrow("above the");
  });
});
