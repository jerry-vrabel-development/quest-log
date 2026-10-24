/**
 * Cloud backup for moment files (photos, videos, music files, recordings) and pictures attached
 * to check-ins.
 *
 * With sync on, each file is encrypted on this device (src/core/vault.ts) and uploaded; files saved
 * on another device are downloaded, decrypted and kept here; deleted moments are removed from the
 * cloud. The server never sees a file's contents or type. Without sync, files stay on the device.
 *
 * A pass runs after every successful sync and after saving a moment. Passes never overlap.
 */
import { fileIds } from "../core/moments";
import { MEDIA_QUOTA_BYTES, seal, unseal, vaultKey } from "../core/vault";
import { $ } from "./dom";
import { getMedia, hasLocalMedia, loadMediaIndex, saveMedia } from "./media";
import { render } from "./render";
import { S } from "./store";
import { SYNC, apiFetch, onSynced } from "./sync";

interface RemoteItem {
  id: string;
  size: number;
  at: number;
}

/** A backed-up file no moment uses any more is cleaned up once it's this old (a day). */
const ORPHAN_AGE_MS = 86_400_000;

type Status = { kind: "idle" } | { kind: "ok"; count: number; used: number } | { kind: "full" } | { kind: "offline" };
let status: Status = { kind: "idle" };

let keyFor: { code: string; key: Promise<CryptoKey> } | null = null;
function key(code: string): Promise<CryptoKey> {
  if (keyFor?.code !== code) keyFor = { code, key: vaultKey(code) };
  return keyFor.key;
}

const mb = (n: number) => (n < 1024 * 1024 ? "under 1 MB" : `${String(Math.round(n / (1024 * 1024)))} MB`);

function showStatus(): void {
  const p = document.querySelector<HTMLElement>("#backupStatus");
  if (!p) return;
  p.hidden = !SYNC.code || status.kind === "idle";
  p.textContent =
    status.kind === "ok" ?
      `Moments backup: ${String(status.count)} file${status.count === 1 ? "" : "s"}, ${mb(status.used)} of ${mb(MEDIA_QUOTA_BYTES)}. Encrypted on this device before upload.`
    : status.kind === "full" ? `Moments backup is full (${mb(MEDIA_QUOTA_BYTES)}). New moments stay on this device.`
    : status.kind === "offline" ? "Moments backup: couldn't reach the server. It will try again."
    : "";
}

async function list(): Promise<{ items: RemoteItem[]; used: number }> {
  const res = await apiFetch("/api/media");
  if (!res.ok) throw new Error(`list ${String(res.status)}`);
  return (await res.json()) as { items: RemoteItem[]; used: number };
}

/** Uploads one file. Returns false when the account's backup is full. */
async function upload(code: string, id: string): Promise<boolean> {
  const blob = await getMedia(id);
  if (!blob) return true;
  const sealed = await seal(await key(code), id, new Uint8Array(await blob.arrayBuffer()), blob.type);
  const res = await apiFetch(`/api/media/${id}`, {
    method: "PUT",
    headers: { "content-type": "application/octet-stream" },
    body: sealed,
  });
  if (res.status === 413) return false;
  if (!res.ok) throw new Error(`upload ${String(res.status)}`);
  return true;
}

async function restore(code: string, id: string): Promise<void> {
  const res = await apiFetch(`/api/media/${id}`);
  if (!res.ok) return;
  const { data, type } = await unseal(await key(code), id, new Uint8Array(await res.arrayBuffer()));
  await saveMedia(id, new Blob([data], { type }));
}

async function pass(): Promise<void> {
  const code = SYNC.code;
  if (!code) {
    status = { kind: "idle" };
    return;
  }
  await loadMediaIndex(); // know what's already here before deciding what to fetch
  const remote = await list();
  const there = new Set(remote.items.map((i) => i.id));
  const withFiles = fileIds(S); // moment files and check-in pictures
  let full = false;
  let restored = 0;
  for (const m of withFiles) {
    if (hasLocalMedia(m.id) && !there.has(m.id) && !full) full = !(await upload(code, m.id));
    else if (!hasLocalMedia(m.id) && there.has(m.id)) {
      try {
        await restore(code, m.id);
        restored++;
      } catch (e) {
        console.warn("Couldn't restore a moment file", e); // wrong key or damaged: leave it in the cloud
      }
    }
  }
  const wanted = new Set(withFiles.map((m) => m.id));
  const now = Date.now();
  for (const item of remote.items)
    if (!wanted.has(item.id) && now - item.at > ORPHAN_AGE_MS) await removeBackup(item.id);
  if (restored) render();
  const after = await list();
  status = full ? { kind: "full" } : { kind: "ok", count: after.items.length, used: after.used };
}

let running: Promise<void> | null = null;
let again = false;

/** Runs a backup pass now, or right after the one in progress. */
export function backupSoon(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = pass()
    .catch(() => {
      status = SYNC.code ? { kind: "offline" } : { kind: "idle" };
    })
    .finally(() => {
      running = null;
      showStatus();
      if (again) {
        again = false;
        void backupSoon();
      }
    });
  return running;
}

/** Removes a deleted moment's file from the cloud (best effort; a later pass cleans up misses). */
export async function removeBackup(id: string): Promise<void> {
  if (!SYNC.code) return;
  try {
    await apiFetch(`/api/media/${id}`, { method: "DELETE" });
  } catch {
    /* offline: the orphan sweep will catch it */
  }
}

export function initBackup(): void {
  onSynced(() => void backupSoon());
  $("#backupStatus").hidden = true;
}
