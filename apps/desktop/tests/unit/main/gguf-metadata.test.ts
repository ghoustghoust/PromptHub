import { describe, expect, it } from "vitest";
import { parseGgufMtpSupport } from "../../../src/main/services/gguf-metadata";

class Writer {
  private chunks: Buffer[] = [];

  u32(value: number): this {
    const buffer = Buffer.alloc(4);
    buffer.writeUInt32LE(value);
    this.chunks.push(buffer);
    return this;
  }

  u64(value: number): this {
    const buffer = Buffer.alloc(8);
    buffer.writeBigUInt64LE(BigInt(value));
    this.chunks.push(buffer);
    return this;
  }

  string(value: string): this {
    const bytes = Buffer.from(value, "utf8");
    return this.u64(bytes.length).bytes(bytes);
  }

  bytes(value: Buffer): this {
    this.chunks.push(value);
    return this;
  }

  build(): Buffer {
    return Buffer.concat(this.chunks);
  }
}

function gguf(entries: Array<{ key: string; type: number; write: (writer: Writer) => void }>): Buffer {
  const writer = new Writer().u32(0x46554747).u32(3).u64(0).u64(entries.length);
  for (const entry of entries) {
    writer.string(entry.key).u32(entry.type);
    entry.write(writer);
  }
  return writer.build();
}

function u32Value(value: number) {
  return (writer: Writer) => writer.u32(value);
}

function stringArray(values: string[]) {
  return (writer: Writer) => {
    writer.u32(8).u64(values.length);
    for (const value of values) writer.string(value);
  };
}

describe("GGUF MTP metadata", () => {
  it("reports support when nextn_predict_layers is positive", () => {
    const buffer = gguf([
      { key: "general.architecture", type: 8, write: (writer) => writer.string("qwen35") },
      { key: "nextn_predict_layers", type: 4, write: u32Value(1) },
    ]);
    expect(parseGgufMtpSupport(buffer)).toBe("supported");
  });

  it("reports unsupported when the key is zero or absent", () => {
    expect(parseGgufMtpSupport(gguf([
      { key: "nextn_predict_layers", type: 4, write: u32Value(0) },
    ]))).toBe("unsupported");
    expect(parseGgufMtpSupport(gguf([
      { key: "general.architecture", type: 8, write: (writer) => writer.string("qwen35") },
    ]))).toBe("unsupported");
  });

  it("accepts an architecture-prefixed key", () => {
    const buffer = gguf([
      { key: "qwen35.nextn_predict_layers", type: 4, write: u32Value(2) },
    ]);
    expect(parseGgufMtpSupport(buffer)).toBe("supported");
  });

  it("skips string arrays before the MTP key", () => {
    const buffer = gguf([
      { key: "tokenizer.ggml.tokens", type: 9, write: stringArray(["a", "bb", "ccc"]) },
      { key: "nextn_predict_layers", type: 4, write: u32Value(1) },
    ]);
    expect(parseGgufMtpSupport(buffer)).toBe("supported");
  });

  it("returns unknown when the prefix ends before the verdict", () => {
    const full = gguf([
      { key: "tokenizer.ggml.tokens", type: 9, write: stringArray(["a", "bb", "ccc"]) },
      { key: "nextn_predict_layers", type: 4, write: u32Value(1) },
    ]);
    expect(parseGgufMtpSupport(full.subarray(0, full.length - 8))).toBe("unknown");
  });
});
