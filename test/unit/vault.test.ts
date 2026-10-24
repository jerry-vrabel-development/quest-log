import { describe, expect, it } from "vitest";
import { VAULT_VERSION, seal, unseal, vaultKey } from "../../src/core/vault";
import { CODE, OTHER_CODE } from "../helpers/fixtures";

const ID = "6f1c2b9e-5d1a-4a37-9b0e-2c4d8e7f1a20";
const bytes = (s: string) => new Uint8Array(new TextEncoder().encode(s));

describe("vault: moment files are encrypted on the device", () => {
  it("round-trips a file and its type", async () => {
    const key = await vaultKey(CODE);
    const sealed = await seal(key, ID, bytes("Bash in the waves"), "video/webm");
    expect(sealed[0]).toBe(VAULT_VERSION);
    const { data, type } = await unseal(key, ID, sealed);
    expect(new TextDecoder().decode(data)).toBe("Bash in the waves");
    expect(type).toBe("video/webm");
  });

  it("hides the contents and the file type from the server", async () => {
    const sealed = await seal(await vaultKey(CODE), ID, bytes("Bash in the waves"), "video/webm");
    const asText = new TextDecoder("latin1").decode(sealed);
    expect(asText).not.toContain("Bash");
    expect(asText).not.toContain("video");
  });

  it("never seals the same file the same way twice (fresh IV)", async () => {
    const key = await vaultKey(CODE);
    const a = await seal(key, ID, bytes("same"), "audio/mpeg");
    const b = await seal(key, ID, bytes("same"), "audio/mpeg");
    expect(a).not.toEqual(b);
  });

  it("derives the same key from the same code on every device", async () => {
    const sealed = await seal(await vaultKey(CODE), ID, bytes("riff"), "audio/webm");
    expect((await unseal(await vaultKey(CODE), ID, sealed)).type).toBe("audio/webm");
  });

  it("won't open with another account's code", async () => {
    const sealed = await seal(await vaultKey(CODE), ID, bytes("riff"), "audio/webm");
    await expect(unseal(await vaultKey(OTHER_CODE), ID, sealed)).rejects.toThrow();
  });

  it("won't open a file moved onto another moment", async () => {
    const key = await vaultKey(CODE);
    const sealed = await seal(key, ID, bytes("riff"), "audio/webm");
    await expect(unseal(key, "another-moment-id", sealed)).rejects.toThrow();
  });

  it("detects any change to the stored bytes", async () => {
    const key = await vaultKey(CODE);
    const sealed = await seal(key, ID, bytes("riff"), "audio/webm");
    const last = sealed.length - 1;
    sealed[last] ^= 1;
    await expect(unseal(key, ID, sealed)).rejects.toThrow();
  });

  it("rejects things that aren't sealed files", async () => {
    const key = await vaultKey(CODE);
    await expect(unseal(key, ID, bytes("short"))).rejects.toThrow("Not a Quest Log file");
    await expect(unseal(key, ID, new Uint8Array(64))).rejects.toThrow("Not a Quest Log file");
  });
});
