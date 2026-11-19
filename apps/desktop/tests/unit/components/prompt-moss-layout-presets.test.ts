import { describe, expect, it } from "vitest";
import {
  MOSS_ASPECT_RATIOS,
  MOSS_DEFAULT_MEGAPIXELS,
  MOSS_MEGAPIXEL_OPTIONS,
  mossResolution,
} from "../../../src/renderer/components/prompt/prompt-orchestrator-catalog";

/**
 * Measured from ComfyUI `ResolutionSelector.execute` (multiple = 16) in the
 * installed node: comfy_extras/nodes_resolution.py.
 */
const AT_ONE_MEGAPIXEL: Record<string, [number, number]> = {
  "1:1": [1024, 1024],
  "2:3": [832, 1248],
  "3:2": [1248, 832],
  "3:4": [880, 1184],
  "4:3": [1184, 880],
  "9:16": [768, 1360],
  "16:9": [1360, 768],
  "21:9": [1568, 672],
};

describe("MOSS canvas resolution parity with ComfyUI ResolutionSelector", () => {
  it("matches the node output for every offered ratio at 1 MP", () => {
    expect(MOSS_ASPECT_RATIOS.map((entry) => entry.label)).toEqual(
      Object.keys(AT_ONE_MEGAPIXEL),
    );
    for (const entry of MOSS_ASPECT_RATIOS) {
      const [width, height] = AT_ONE_MEGAPIXEL[entry.label];
      expect(mossResolution(entry.label, 1), entry.label).toEqual({ width, height });
    }
  });

  it("scales with megapixels instead of hard-coding a single canvas", () => {
    expect(MOSS_DEFAULT_MEGAPIXELS).toBe("1");
    expect(mossResolution("9:16", 2)).toEqual({ width: 1088, height: 1936 });
    expect(mossResolution("21:9", 2)).toEqual({ width: 2208, height: 944 });
    expect(mossResolution("2:3", 1.5)).toEqual({ width: 1024, height: 1536 });
    expect(mossResolution("1:1", 4)).toEqual({ width: 2048, height: 2048 });

    for (const option of MOSS_MEGAPIXEL_OPTIONS) {
      for (const entry of MOSS_ASPECT_RATIOS) {
        const size = mossResolution(entry.label, Number(option));
        if (!size) throw new Error(`missing size for ${entry.label} at ${option} MP`);
        const label = `${entry.label}@${option}`;
        expect(size.width % 16, label).toBe(0);
        expect(size.height % 16, label).toBe(0);
        expect(size.width * size.height, label).toBeGreaterThanOrEqual(512 * 512);
        expect(size.width * size.height, label).toBeLessThanOrEqual(4.2 * 1024 * 1024);
      }
    }
  });

  it("keeps 9:21 out of the presets because the node cannot produce it", () => {
    expect(MOSS_ASPECT_RATIOS.map((entry) => String(entry.label))).not.toContain("9:21");
    expect(mossResolution("9:21", 1)).toBeNull();
  });
});