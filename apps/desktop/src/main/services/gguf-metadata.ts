/**
 * Reads the GGUF metadata prefix and reports whether the file carries MTP
 * (next-token prediction) layers. Only the first few MB are parsed, because
 * architecture keys normally precede the tokenizer arrays; if the scan cannot
 * finish inside the prefix the answer is "unknown" rather than a false negative.
 */

export type GgufMtpSupport = "supported" | "unsupported" | "unknown";

const GGUF_MAGIC = 0x46554747;

class Cursor {
  offset = 0;

  constructor(private readonly buffer: Buffer) {}

  private need(bytes: number): void {
    if (this.offset + bytes > this.buffer.length) {
      throw new Error("gguf-prefix-exhausted");
    }
  }

  u8(): number {
    this.need(1);
    const value = this.buffer.readUInt8(this.offset);
    this.offset += 1;
    return value;
  }

  u32(): number {
    this.need(4);
    const value = this.buffer.readUInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  u16(): number {
    this.need(2);
    const value = this.buffer.readUInt16LE(this.offset);
    this.offset += 2;
    return value;
  }

  u64(): bigint {
    this.need(8);
    const value = this.buffer.readBigUInt64LE(this.offset);
    this.offset += 8;
    return value;
  }

  bytes(length: number): void {
    this.need(length);
    this.offset += length;
  }

  string(): string {
    const length = Number(this.u64());
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new Error("gguf-invalid-string");
    }
    this.need(length);
    const value = this.buffer.toString("utf8", this.offset, this.offset + length);
    this.offset += length;
    return value;
  }
}

const SCALAR_SIZE: Record<number, number> = {
  0: 1, // UINT8
  1: 1, // INT8
  2: 2, // UINT16
  3: 2, // INT16
  4: 4, // UINT32
  5: 4, // INT32
  6: 4, // FLOAT32
  7: 1, // BOOL
  10: 8, // UINT64
  11: 8, // INT64
  12: 8, // FLOAT64
};

function skipValue(cursor: Cursor, type: number, depth = 0): void {
  if (depth > 2) throw new Error("gguf-nested-too-deep");
  const size = SCALAR_SIZE[type];
  if (size !== undefined) {
    cursor.bytes(size);
    return;
  }
  if (type === 8) {
    cursor.string();
    return;
  }
  if (type === 9) {
    const elementType = cursor.u32();
    const count = Number(cursor.u64());
    if (!Number.isSafeInteger(count) || count < 0 || count > 5_000_000) {
      throw new Error("gguf-invalid-array");
    }
    for (let index = 0; index < count; index += 1) {
      skipValue(cursor, elementType, depth + 1);
    }
    return;
  }
  throw new Error("gguf-unknown-type");
}

function readNumeric(cursor: Cursor, type: number): number | null {
  switch (type) {
    case 0:
      return cursor.u8();
    case 2:
      return cursor.u16();
    case 4:
      return cursor.u32();
    case 5: {
      const value = cursor.u32();
      return value > 0x7fffffff ? value - 0x1_0000_0000 : value;
    }
    case 10:
      return Number(cursor.u64());
    case 11: {
      const value = cursor.u64();
      return Number(BigInt.asIntN(64, value));
    }
    default:
      return null;
  }
}

function isMtpKey(key: string): boolean {
  return key === "nextn_predict_layers" || key.endsWith(".nextn_predict_layers");
}

export function parseGgufMtpSupport(prefix: Buffer): GgufMtpSupport {
  try {
    const cursor = new Cursor(prefix);
    if (cursor.u32() !== GGUF_MAGIC) return "unknown";
    cursor.u32(); // version
    cursor.u64(); // tensor count
    const kvCount = Number(cursor.u64());
    if (!Number.isSafeInteger(kvCount) || kvCount < 0 || kvCount > 1_000_000) {
      return "unknown";
    }
    for (let index = 0; index < kvCount; index += 1) {
      const key = cursor.string();
      const type = cursor.u32();
      if (isMtpKey(key) && (type === 0 || type === 2 || type === 4 || type === 5 || type === 10 || type === 11)) {
        const value = readNumeric(cursor, type);
        return value !== null && value > 0 ? "supported" : "unsupported";
      }
      skipValue(cursor, type);
    }
    return "unsupported";
  } catch (error) {
    if (error instanceof Error && error.message === "gguf-prefix-exhausted") {
      return "unknown";
    }
    return "unknown";
  }
}
