/**
 * End-to-end encryption for moment files backed up to the cloud.
 *
 * The key is derived on the device from the sync code (HKDF-SHA-256). The server only ever sees
 * the code's SHA-256 hash (as the account id) and the encrypted bytes, so it can't read a photo,
 * a video, a song or a recording, or even tell which kind of file it is.
 *
 * Sealed format: [version: 1 byte][IV: 12 bytes][AES-256-GCM ciphertext + 16-byte tag].
 * The plaintext is [type length: 1 byte][MIME type][file bytes], and the moment id is bound in as
 * additional data, so a file can't be swapped onto another moment without failing to open.
 */
import { VIDEO_MAX_BYTES } from "./moments";

export const VAULT_VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const TYPE_MAX = 255;
/** Biggest sealed file the server accepts: the biggest moment file plus room for the envelope. */
export const SEALED_MAX_BYTES = VIDEO_MAX_BYTES + 1 + IV_BYTES + TAG_BYTES + 1 + TYPE_MAX;
/** Cloud space per account. The free R2 tier is 10 GB, so this keeps one account well inside it. */
export const MEDIA_QUOTA_BYTES = 2 * 1024 ** 3;

const enc = new TextEncoder();
const dec = new TextDecoder();
type Bytes = Uint8Array<ArrayBuffer>;

/** The media key for a sync code. Anyone with the code can open the files, just as they can sync. */
export async function vaultKey(syncCode: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", enc.encode(syncCode), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: enc.encode("quest-log/media/v1"), info: enc.encode("aes-256-gcm") },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Encrypts a file for upload, bound to its moment id. */
export async function seal(key: CryptoKey, id: string, data: Bytes, type: string): Promise<Bytes> {
  const t = enc.encode(type.slice(0, TYPE_MAX)).slice(0, TYPE_MAX);
  const plain = new Uint8Array(1 + t.length + data.length);
  plain[0] = t.length;
  plain.set(t, 1);
  plain.set(data, 1 + t.length);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(id) }, key, plain),
  );
  const out = new Uint8Array(1 + IV_BYTES + cipher.length);
  out[0] = VAULT_VERSION;
  out.set(iv, 1);
  out.set(cipher, 1 + IV_BYTES);
  return out;
}

/** Decrypts a downloaded file. Throws if it was altered, belongs to another moment, or the key is wrong. */
export async function unseal(key: CryptoKey, id: string, sealed: Bytes): Promise<{ data: Bytes; type: string }> {
  if (sealed.length < 1 + IV_BYTES + TAG_BYTES + 1 || sealed[0] !== VAULT_VERSION)
    throw new Error("Not a Quest Log file");
  const plain = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: sealed.slice(1, 1 + IV_BYTES), additionalData: enc.encode(id) },
      key,
      sealed.slice(1 + IV_BYTES),
    ),
  );
  const typeLen = plain[0]; // at least one byte: the length check above guarantees it
  return { type: dec.decode(plain.subarray(1, 1 + typeLen)), data: plain.slice(1 + typeLen) };
}
