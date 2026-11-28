import { describe, expect, it } from "vitest";
import { assetMetaEntries, assetPageRange, assetSubtitle } from "../../../src/renderer/components/prompt/asset-gallery-view";
import type { PromptSourceAsset } from "@prompthub/shared/types";

const asset = (overrides: Partial<PromptSourceAsset>): PromptSourceAsset => ({
  id: "ghil:costume:1",
  kind: "costume",
  path: "G:/lib/costume/1.png",
  title: "black coat",
  meta: {},
  createdAt: 0,
  ...overrides,
});

describe("assetSubtitle", () => {
  it("uses the category for costumes", () => {
    expect(assetSubtitle(asset({ meta: { category: "外套" } }))).toBe("外套");
  });

  it("prefers the localized section for hair and portraits", () => {
    expect(assetSubtitle(asset({ kind: "hair", meta: { section: "long", sectionZh: "长发" } }))).toBe(
      "长发",
    );
    expect(assetSubtitle(asset({ kind: "portrait", meta: { section: "front" } }))).toBe("front");
  });

  it("joins the pose group, number and angle", () => {
    expect(
      assetSubtitle(
        asset({ kind: "pose", meta: { group: "体系A", poseNumber: "12", angle: "正面" } }),
      ),
    ).toBe("体系A · 12 · 正面");
  });

  it("stays empty for an unknown library", () => {
    expect(assetSubtitle(asset({ kind: "unknown" }))).toBe("");
  });
});

describe("assetMetaEntries", () => {
  it("skips pictures and internal index paths but keeps arrays", () => {
    const entries = assetMetaEntries(
      asset({
        meta: {
          library: "ghil",
          thumbnail: "thumb.png",
          sourceIndex: "costume/data/costume-zh.json",
          keywords: ["雨衣", "外套"],
          width: 1024,
          empty: [],
        },
      }),
    );
    expect(entries.map((entry) => entry.key)).toEqual(["library", "keywords", "width"]);
    expect(entries[1].value).toBe("雨衣, 外套");
    expect(entries[2].value).toBe("1024");
  });
});

describe("assetPageRange", () => {
  it("shows the visible slice against the real total", () => {
    expect(assetPageRange(0, 24, 5238)).toBe("1–24 / 5238");
    expect(assetPageRange(24, 24, 5238)).toBe("25–48 / 5238");
    expect(assetPageRange(0, 0, 0)).toBe("0 / 0");
  });
});