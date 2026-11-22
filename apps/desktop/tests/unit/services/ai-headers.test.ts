import { describe, expect, it } from "vitest";
import { buildHeadersForProtocol } from "@prompthub/shared/utils/ai-protocol";

describe("AI protocol headers", () => {
  it("omits authorization when the key is empty (local providers)", () => {
    const headers = buildHeadersForProtocol("openai", "");
    expect(headers).not.toHaveProperty("Authorization");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("keeps the bearer header when a key is present", () => {
    expect(buildHeadersForProtocol("openai", "secret").Authorization).toBe("Bearer secret");
  });
});
