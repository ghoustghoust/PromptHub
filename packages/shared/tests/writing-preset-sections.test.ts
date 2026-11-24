import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assembleWritingLayerText,
  removeSectionHeading,
  splitWritingPresetSections,
  splitWritingPresetSectionsWithContent,
} from "@prompthub/shared/utils/writing-preset-sections";

const DOCUMENT = [
  "Intro paragraph.",
  "",
  "## First",
  "Alpha body.",
  "",
  "## Second",
  "Beta body.",
].join("\n");

describe("writing preset sections", () => {
  it("splits headings and keeps content out of the metadata projection", () => {
    const withContent = splitWritingPresetSectionsWithContent(DOCUMENT);
    assert.deepEqual(withContent.map((section) => section.title), ["概述", "First", "Second"]);
    assert.equal(withContent[1].content, "Alpha body.");
    const metadata = splitWritingPresetSections(DOCUMENT);
    assert.deepEqual(Object.keys(metadata[0]).sort(), [
      "charCount",
      "id",
      "title",
      "tokenEstimate",
    ]);
  });

  it("returns the stored text untouched when every section is selected", () => {
    const ids = splitWritingPresetSections(DOCUMENT).map((section) => section.id);
    assert.equal(assembleWritingLayerText(DOCUMENT, ids), DOCUMENT);
  });

  it("rebuilds only the selected sections with their headings", () => {
    const sections = splitWritingPresetSections(DOCUMENT);
    assert.equal(
      assembleWritingLayerText(DOCUMENT, [sections[2].id]),
      "## Second\nBeta body.",
    );
    assert.equal(
      assembleWritingLayerText(DOCUMENT, [sections[0].id]),
      "Intro paragraph.",
    );
    assert.equal(assembleWritingLayerText(DOCUMENT, []), "");
    assert.equal(assembleWritingLayerText(DOCUMENT, ["missing-id"]), "");
  });

  it("merges a section by deleting its heading line", () => {
    const merged = removeSectionHeading(DOCUMENT, "Second");
    assert.equal(merged.includes("## Second"), false);
    assert.equal(merged.includes("Beta body."), true);
    assert.deepEqual(
      splitWritingPresetSections(merged).map((section) => section.title),
      ["概述", "First"],
    );
    // Unknown titles are a no-op, not a silent deletion.
    assert.equal(removeSectionHeading(DOCUMENT, "Missing"), DOCUMENT);
  });

  it("treats a heading-free document as one whole-text section", () => {
    const sections = splitWritingPresetSections("Only prose.\n\nStill prose.");
    assert.equal(sections.length, 1);
    assert.equal(sections[0].title, "全文");
    assert.equal(
      assembleWritingLayerText("Only prose.\n\nStill prose.", [sections[0].id]),
      "Only prose.\n\nStill prose.",
    );
  });
});
