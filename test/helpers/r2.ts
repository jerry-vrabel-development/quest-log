// An in-memory R2 bucket for tests: the slice of the R2 API the Worker uses (put, get, delete).
export interface TestR2 {
  objects: Map<string, Uint8Array>;
}

async function bytesOf(value: unknown): Promise<Uint8Array> {
  if (value instanceof ReadableStream) return new Uint8Array(await new Response(value).arrayBuffer());
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (typeof value === "string") return new TextEncoder().encode(value);
  throw new TypeError("unsupported R2 value");
}

export function createR2(): R2Bucket & TestR2 {
  const objects = new Map<string, Uint8Array>();
  const bucket = {
    objects,
    async put(key: string, value: unknown) {
      const data = await bytesOf(value);
      objects.set(key, data);
      return { key, size: data.byteLength };
    },
    async get(key: string) {
      const data = objects.get(key);
      if (!data) return null;
      return { key, size: data.byteLength, body: new Response(data.slice()).body };
    },
    async delete(key: string) {
      objects.delete(key);
    },
  };
  return bucket as unknown as R2Bucket & TestR2;
}
