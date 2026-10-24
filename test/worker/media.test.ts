import { beforeEach, describe, expect, it, vi } from "vitest";
import { MEDIA_QUOTA_BYTES, SEALED_MAX_BYTES } from "../../src/core/vault";
import { handleApi, type ApiEnv } from "../../src/worker/api";
import { sha256Hex } from "../../src/worker/http";
import { createD1, type TestD1 } from "../helpers/d1";
import { CODE, OTHER_CODE } from "../helpers/fixtures";
import { body as read } from "../helpers/http";
import { createR2, type TestR2 } from "../helpers/r2";

let env: ApiEnv & { DB: TestD1; MEDIA: TestR2 };
beforeEach(() => {
  env = {
    DB: createD1(),
    MEDIA: createR2(),
    VAPID_PUBLIC_KEY: "k",
    VAPID_PRIVATE_JWK: "{}",
    VAPID_SUBJECT: "mailto:t@x",
  };
});

const ID = "6f1c2b9e-5d1a-4a37-9b0e-2c4d8e7f1a20";
const push = vi.fn(async () => 0);

function call(method: string, path: string, opts: { data?: Uint8Array; code?: string | null; length?: string } = {}) {
  const { data, code = CODE } = opts;
  const headers: Record<string, string> = code ? { Authorization: `Bearer ${code}` } : {};
  if (data) headers["content-length"] = opts.length ?? String(data.byteLength);
  return handleApi(
    new Request(`https://q.test${path}`, { method, headers, body: data ? data.slice() : undefined }),
    env,
    { push },
  );
}
const upload = (id: string, data: Uint8Array, code = CODE) => call("PUT", `/api/media/${id}`, { data, code });

describe("media backup", () => {
  it("stores a file under the account's hashed id and gives it back byte for byte", async () => {
    const data = new Uint8Array([1, 2, 3, 250, 0, 7]);
    expect(await read(await upload(ID, data))).toEqual({ ok: true, size: 6 });
    expect([...env.MEDIA.objects.keys()]).toEqual([`${await sha256Hex(CODE)}/${ID}`]);
    const res = await call("GET", `/api/media/${ID}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(data);
  });

  it("lists what's backed up and how much space it uses", async () => {
    await upload(ID, new Uint8Array(10));
    await upload("a1b2c3d4-0000-0000-0000-000000000000", new Uint8Array(5));
    const list = await read(await call("GET", "/api/media"));
    expect(list.items.map((i: { id: string; size: number }) => [i.id, i.size])).toEqual([
      [ID, 10],
      ["a1b2c3d4-0000-0000-0000-000000000000", 5],
    ]);
    expect(list).toMatchObject({ used: 15, quota: MEDIA_QUOTA_BYTES });
  });

  it("replacing a file counts its new size only", async () => {
    await upload(ID, new Uint8Array(10));
    await upload(ID, new Uint8Array(4));
    expect(await read(await call("GET", "/api/media"))).toMatchObject({ used: 4 });
  });

  it("deletes the file and its record", async () => {
    await upload(ID, new Uint8Array(3));
    expect((await call("DELETE", `/api/media/${ID}`)).status).toBe(200);
    expect(env.MEDIA.objects.size).toBe(0);
    expect((await call("GET", `/api/media/${ID}`)).status).toBe(404);
    expect(await read(await call("GET", "/api/media"))).toMatchObject({ items: [], used: 0 });
  });

  it("keeps accounts apart: another sync code can't see, read or delete your files", async () => {
    await upload(ID, new Uint8Array([9]));
    expect(await read(await call("GET", "/api/media", { code: OTHER_CODE }))).toMatchObject({ items: [], used: 0 });
    expect((await call("GET", `/api/media/${ID}`, { code: OTHER_CODE })).status).toBe(404);
    await call("DELETE", `/api/media/${ID}`, { code: OTHER_CODE });
    expect((await call("GET", `/api/media/${ID}`)).status).toBe(200);
  });

  it("needs a sync code", async () => {
    expect((await call("GET", "/api/media", { code: null })).status).toBe(401);
    expect((await upload(ID, new Uint8Array(1), null as unknown as string)).status).toBe(401);
  });

  it.each(["../etc", "a b", "x".repeat(65), "short"])("rejects the id %j", async (id) => {
    const res = await upload(encodeURIComponent(id), new Uint8Array(1));
    expect([400, 404]).toContain(res.status);
    expect(env.MEDIA.objects.size).toBe(0);
  });

  it("turns away files bigger than the biggest moment", async () => {
    const res = await call("PUT", `/api/media/${ID}`, {
      data: new Uint8Array(1),
      length: String(SEALED_MAX_BYTES + 1),
    });
    expect(res.status).toBe(413);
    expect(await read(res)).toEqual({ error: "too_large" });
  });

  it("needs to know the size up front", async () => {
    const res = await call("PUT", `/api/media/${ID}`, { data: new Uint8Array(1), length: "nope" });
    expect(res.status).toBe(411);
  });

  it("stops at the account's quota", async () => {
    const userId = await sha256Hex(CODE);
    env.DB.raw
      .prepare("INSERT INTO media (user_id, id, size, created_at) VALUES (?, ?, ?, ?)")
      .run(userId, "already-there-0001", MEDIA_QUOTA_BYTES - 4, 1);
    const res = await upload(ID, new Uint8Array(5));
    expect(res.status).toBe(413);
    expect(await read(res)).toEqual({ error: "quota" });
    expect((await upload(ID, new Uint8Array(4))).status).toBe(200); // exactly full is fine
  });
});
