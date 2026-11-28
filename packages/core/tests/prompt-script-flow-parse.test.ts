import { describe, expect, it } from "vitest";
import { parseScriptFlow } from "../src/prompt-script-flow";

const version = (overrides: Record<string, unknown> = {}) => ({
  version: 1,
  text: "outline text",
  createdAt: "2026-11-27T00:00:00.000Z",
  ...overrides,
});

describe("parseScriptFlow", () => {
  it("round-trips a stored flow and keeps basedOn", () => {
    const parsed = parseScriptFlow({
      versions: {
        outline: [version()],
        script: [version({ version: 1, text: "script text", basedOn: { outline: 1 } })],
        storyboard: [],
        unit: [],
      },
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.versions.outline[0].text).toBe("outline text");
    expect(parsed?.versions.script[0].basedOn).toEqual({ outline: 1 });
    expect(parsed?.versions.unit).toEqual([]);
  });

  it("returns null for values that are not a flow object", () => {
    expect(parseScriptFlow(null)).toBeNull();
    expect(parseScriptFlow("flow")).toBeNull();
    expect(parseScriptFlow([])).toBeNull();
    expect(parseScriptFlow({ versions: "none" })).toBeNull();
  });

  it("drops malformed versions instead of failing the whole flow", () => {
    const parsed = parseScriptFlow({
      versions: {
        outline: [
          version(),
          version({ version: 0 }),
          version({ text: "   " }),
          version({ createdAt: 5 }),
          { version: 2 },
        ],
        script: [],
        storyboard: [],
        unit: [],
      },
    });
    expect(parsed?.versions.outline).toHaveLength(1);
    expect(parsed?.versions.outline[0].version).toBe(1);
  });

  it("fills missing stages with an empty list", () => {
    const parsed = parseScriptFlow({ versions: { outline: [version()] } });
    expect(parsed?.versions.script).toEqual([]);
    expect(parsed?.versions.storyboard).toEqual([]);
    expect(parsed?.versions.unit).toEqual([]);
  });

  it("keeps only known upstream stages in basedOn", () => {
    const parsed = parseScriptFlow({
      versions: {
        outline: [version()],
        script: [
          version({
            text: "script",
            basedOn: { outline: 1, storyboard: 2, trailer: 3 },
          }),
        ],
        storyboard: [],
        unit: [],
      },
    });
    expect(parsed?.versions.script[0].basedOn).toEqual({ outline: 1 });
  });
});