import { describe, expect, it } from "vitest";
import type { PromptMossLayoutDraft } from "@prompthub/shared/types";
import type { PromptOrchestratorLlm } from "../src/prompt-orchestrator-llm";
import {
  normalizeLayoutBBox,
  refineMossLayoutCaptions,
  reverseMossLayoutFromImages,
} from "../src/prompt-moss-layout-assist";

function fakeLlm(reply: string | (() => Promise<string>)): PromptOrchestratorLlm {
  return {
    complete: async () => (typeof reply === "string" ? reply : await reply()),
  };
}

function draft(): PromptMossLayoutDraft {
  return {
    version: 1,
    canvas: { width: 1024, height: 1024 },
    boxes: [
      {
        id: "background",
        label: "object",
        caption: "",
        bbox: [0, 0, 1000, 1000],
      },
      {
        id: "title",
        label: "text",
        caption: "标题排版",
        text: "SPRING SALE\n-30%",
        bbox: [80, 100, 220, 900],
      },
    ],
  };
}

describe("normalizeLayoutBBox", () => {
  it("accepts 0-1000 yxyx and scales 0-1 floats", () => {
    expect(normalizeLayoutBBox([100, 200, 900, 800])).toEqual([100, 200, 900, 800]);
    expect(normalizeLayoutBBox([0.1, 0.2, 0.9, 0.8])).toEqual([100, 200, 900, 800]);
  });

  it("rejects inverted or malformed rectangles", () => {
    expect(normalizeLayoutBBox([500, 100, 200, 900])).toBeNull();
    expect(normalizeLayoutBBox([0, 0, 100])).toBeNull();
    expect(normalizeLayoutBBox(["0", 0, 100, 100])).toBeNull();
  });
});

describe("refineMossLayoutCaptions", () => {
  it("fills empty captions while leaving exact text untouched", async () => {
    const result = await refineMossLayoutCaptions({
      draft: draft(),
      intent: "Spring sale poster",
      llm: fakeLlm(
        JSON.stringify({ captions: ["Soft gradient spring background", "Bold condensed title"] }),
      ),
    });
    expect(result.status).toBe("complete");
    expect(result.captions).toEqual([
      "Soft gradient spring background",
      "Bold condensed title",
    ]);
    expect(draft().boxes[1].text).toBe("SPRING SALE\n-30%");
  });

  it("degrades with the user's own captions when the model fails", async () => {
    const result = await refineMossLayoutCaptions({
      draft: draft(),
      llm: fakeLlm(() => Promise.reject(new Error("endpoint down"))),
    });
    expect(result.status).toBe("degraded");
    expect(result.captions).toEqual(["", "标题排版"]);
    expect(result.warnings.join(" ")).toContain("endpoint down");
  });

  it("rejects a caption array that does not match the box count", async () => {
    const result = await refineMossLayoutCaptions({
      draft: draft(),
      llm: fakeLlm(JSON.stringify({ captions: ["only one"] })),
    });
    expect(result.status).toBe("degraded");
  });
});

describe("reverseMossLayoutFromImages", () => {
  it("normalizes recognized boxes and flags uncertain text", async () => {
    const result = await reverseMossLayoutFromImages({
      images: ["data:image/png;base64,AAAA"],
      canvas: { width: 1024, height: 1024 },
      llm: fakeLlm(
        JSON.stringify({
          summary: "A retro travel poster with a large title",
          boxes: [
            {
              label: "object",
              caption: "Full-bleed teal sky with grain",
              bbox: [0, 0, 1, 1],
            },
            {
              label: "text",
              caption: "Condensed uppercase sans title",
              text: "EXP?ORE",
              needsReview: true,
              bbox: [80, 100, 220, 900],
            },
            { label: "object", caption: "broken", bbox: [900, 900, 100, 100] },
          ],
        }),
      ),
    });
    expect(result.status).toBe("degraded");
    expect(result.draft.boxes).toHaveLength(2);
    expect(result.draft.boxes[0].bbox).toEqual([0, 0, 1000, 1000]);
    expect(result.draft.boxes[1].label).toBe("text");
    expect(result.draft.boxes[1].text).toBe("EXP?ORE");
    expect(result.draft.boxes[1].needsReview).toBe(true);
    expect(result.warnings.join(" ")).toContain("Box 3");
    expect(result.summary).toContain("retro travel poster");
  });

  it("degrades to an empty draft when nothing usable is returned", async () => {
    const result = await reverseMossLayoutFromImages({
      images: ["data:image/png;base64,AAAA"],
      canvas: { width: 768, height: 1024 },
      llm: fakeLlm(JSON.stringify({ summary: "", boxes: [] })),
    });
    expect(result.status).toBe("degraded");
    expect(result.draft.boxes).toHaveLength(0);
  });

  it("refuses to run without an image", async () => {
    const result = await reverseMossLayoutFromImages({
      images: [],
      canvas: { width: 1024, height: 1024 },
      llm: fakeLlm("{}"),
    });
    expect(result.status).toBe("degraded");
    expect(result.draft.boxes).toHaveLength(0);
  });

  it("keeps free-form labels as objects instead of dropping the box", async () => {
    const result = await reverseMossLayoutFromImages({
      images: ["data:image/png;base64,AAAA"],
      canvas: { width: 1024, height: 1024 },
      llm: fakeLlm(JSON.stringify({
        summary: "A poster",
        boxes: [
          { label: "background", caption: "Teal sky with grain", bbox: [0, 0, 1000, 1000] },
          { label: "title_bar", caption: "Top strip", bbox: [0, 0, 1000, 80] },
          { label: "character", caption: "A cat", bbox: [200, 200, 800, 800] },
        ],
      })),
    });
    expect(result.draft.boxes).toHaveLength(3);
    expect(result.draft.boxes.map((box) => box.label)).toEqual(["object", "object", "object"]);
    expect(result.status).toBe("complete");
  });

  it("asks for a layout-sized output budget", async () => {
    let requested: number | undefined;
    await reverseMossLayoutFromImages({
      images: ["data:image/png;base64,AAAA"],
      canvas: { width: 1024, height: 1024 },
      llm: {
        complete: async (request) => {
          requested = request.maxTokens;
          return JSON.stringify({
            summary: "x",
            boxes: [{ label: "object", caption: "c", bbox: [0, 0, 100, 100] }],
          });
        },
      },
    });
    expect(requested).toBe(4096);
  });
});
