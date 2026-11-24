import { describe, expect, it } from "vitest";
import {
  extractClipboardPaths,
  normalizeClipboardPath,
  parseDropFiles,
} from "../../../src/main/services/clipboard-files";

function dropFilesBuffer(paths: string[]): Buffer {
  const header = Buffer.alloc(20);
  header.writeUInt32LE(20, 0);
  header.writeUInt32LE(1, 16);
  const list = Buffer.from(`${paths.join("\0")}\0\0`, "utf16le");
  return Buffer.concat([header, list]);
}

describe("clipboard file paths", () => {
  it("parses an Explorer CF_HDROP/DROPFILES payload", () => {
    const paths = parseDropFiles(
      dropFilesBuffer(["C:\\images\\portrait.png", "C:\\images\\second.png"]),
    );
    expect(paths).toEqual(["C:\\images\\portrait.png", "C:\\images\\second.png"]);
  });

  it("does not treat a bare UTF-16 path as a DROPFILES header", () => {
    const bare = Buffer.from("C:\\images\\portrait.png\0", "utf16le");
    expect(parseDropFiles(bare)).toEqual([]);
    expect(extractClipboardPaths({ fileNameW: bare })).toEqual([
      "C:\\images\\portrait.png",
    ]);
  });

  it("strips quotes and accepts file URIs", () => {
    expect(normalizeClipboardPath('"C:\\images\\portrait.png"')).toBe(
      "C:\\images\\portrait.png",
    );
    expect(normalizeClipboardPath("file:///C:/images/portrait.png")).toMatch(
      /images[\\/]portrait\.png$/,
    );
    expect(normalizeClipboardPath("portrait.png")).toBeNull();
    expect(normalizeClipboardPath("hello world")).toBeNull();
  });

  it("orders and de-duplicates candidates from every clipboard format", () => {
    const paths = extractClipboardPaths({
      fileNameW: dropFilesBuffer(["C:\\a.png"]),
      uriList: "file:///C:/b.png\r\n# comment\r\nfile:///C:/a.png",
      text: "\"C:\\c.png\"\r\nC:\\a.png",
    });
    expect(paths).toEqual(["C:\\a.png", "C:\\b.png", "C:\\c.png"]);
  });

  it("ignores empty or non-path text", () => {
    expect(extractClipboardPaths({ text: "just some copied words" })).toEqual([]);
    expect(extractClipboardPaths({})).toEqual([]);
  });
});
