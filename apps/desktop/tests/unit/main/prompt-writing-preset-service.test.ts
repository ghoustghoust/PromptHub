import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BUILTIN_PROMPT_WRITING_PRESETS } from "@prompthub/core";
import { SCHEMA_TABLES } from "@prompthub/db";
import DatabaseAdapter from "../../../src/main/database/sqlite";
import { DesktopPromptWritingPresetService } from "../../../src/main/services/prompt-writing-preset-service";

let rawDb: DatabaseAdapter.Database;
let service: DesktopPromptWritingPresetService;
let tempDir: string;

beforeEach(() => {
  rawDb = new DatabaseAdapter(":memory:");
  rawDb.pragma("foreign_keys = ON");
  rawDb.exec(SCHEMA_TABLES);
  service = new DesktopPromptWritingPresetService(rawDb);
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "writing-preset-"));
});

afterEach(() => {
  rawDb.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("writing preset service", () => {
  it("seeds every shipped preset exactly once", () => {
    const builtins = service.list().filter((item) => item.builtin);
    expect(builtins.map((item) => item.id).sort()).toEqual(
      BUILTIN_PROMPT_WRITING_PRESETS.map((item) => item.id).sort(),
    );
    for (const item of builtins) {
      expect(item.compressedTokenEstimate).toBeGreaterThan(100);
      expect(item.sectionCount).toBeGreaterThan(2);
      expect(item.validationStatus).toBe("unverified");
    }
    // A second instance must not duplicate or rewrite rows.
    const before = service.list();
    const again = new DesktopPromptWritingPresetService(rawDb).list();
    expect(again.map((item) => item.updatedAt)).toEqual(before.map((item) => item.updatedAt));
  });

  it("stores an imported document with its original and sections", async () => {
    const filePath = path.join(tempDir, "saved-guide.htm");
    fs.writeFileSync(
      filePath,
      `<html><head><title>Saved guide</title><script>noise()</script></head>
       <body><main><h1>Caption</h1><p>Write prose.</p><h2>Tags</h2><p>No @ prefix.</p></main></body></html>`,
      "utf8",
    );

    const imported = await service.importFile(filePath);
    expect(imported.sourceFile).toBe("saved-guide.htm");
    expect(imported.suggestedName).toBe("Saved guide");
    expect(imported.extractedContent).toContain("## Tags");
    expect(imported.sections.map((section) => section.title)).toEqual(["Caption", "Tags"]);

    const saved = service.save({
      name: imported.suggestedName,
      targetSkill: "k2",
      methodology: "official-guide",
      sourceFile: imported.sourceFile,
      compressedContent: "## Tags\nNo @ prefix.",
      originalContent: imported.extractedContent,
    });
    const reloaded = service.get(saved.id);
    expect(reloaded?.hasOriginal).toBe(true);
    expect(reloaded?.originalSections?.length).toBe(2);
    expect(reloaded?.compressedSections[0]?.title).toBe("Tags");
    expect(reloaded?.originalContent).toContain("Write prose.");
    expect(reloaded?.originalContent).not.toContain("noise()");
  });

  it("refuses to import unsupported or missing files", async () => {
    const docx = path.join(tempDir, "guide.docx");
    fs.writeFileSync(docx, "not really a docx", "utf8");
    await expect(service.importFile(docx)).rejects.toThrow("Unsupported writing document type");
    await expect(service.importFile(path.join(tempDir, "missing.txt"))).rejects.toThrow(
      "was not found",
    );
    await expect(service.importFile("")).rejects.toThrow("must be a non-empty string");
  });

  it("protects built-in rows through the service layer", () => {
    const builtin = service.list().find((item) => item.builtin);
    expect(builtin).toBeTruthy();
    expect(() =>
      service.save({
        id: builtin!.id,
        name: "Hijack",
        targetSkill: "any",
        methodology: "writing-guide",
        compressedContent: "X",
      }),
    ).toThrow("read-only");
  });
});
