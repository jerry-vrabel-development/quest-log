/**
 * Device sync and push subscription against the Cloudflare Worker.
 * The sync code is a random 256-bit secret; the server only ever sees it as a bearer token
 * and stores its SHA-256 hash. Conflicts are last-write-wins with a 409 guard.
 */
import { isPrivateBundle, mergeState, splitState, type SharedState } from "../core/privacy";
import type { State } from "../core/types";
import { seal, unseal, vaultKey } from "../core/vault";
import { processRewards } from "./actions";
import { DEMO } from "./demo";
import { $ } from "./dom";
import { hasNotif } from "./reminders";
import { render } from "./render";
import { applyTheme } from "./settings";
import { S, onSave, prefs, saveLocal, setState } from "./store";
import { toast } from "./toast";

const SYNC_KEY = "quest-log-sync";
/** Read by the service worker to fetch the push outbox. */
export const CONFIG_CACHE = "quest-log-config";
const PUSH_DEBOUNCE_MS = 1200;
export const CODE_RE = /^[A-Za-z0-9_-]{32,128}$/;

interface SyncSettings {
  code?: string;
  push?: boolean;
}

export let SYNC: SyncSettings = (() => {
  try {
    return (JSON.parse(prefs.get(SYNC_KEY) || "{}") as SyncSettings | null) ?? {};
  } catch {
    return {};
  }
})();

type SyncStatus = "" | "synced" | "offline" | "error";

/** Called after each successful sync with the server, and when sync is turned off. */
const syncListeners: (() => void)[] = [];
export function onSynced(fn: () => void): void {
  syncListeners.push(fn);
}
const synced = () => {
  for (const fn of syncListeners) fn();
};
let syncStatus: SyncStatus = "";
let pushTimer: ReturnType<typeof setTimeout> | undefined;

const onServer = () => location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname);

function saveSync(): void {
  prefs.set(SYNC_KEY, JSON.stringify(SYNC));
  void writeSwConfig();
}

export async function writeSwConfig(): Promise<void> {
  try {
    const c = await caches.open(CONFIG_CACHE);
    await c.put("/__config", new Response(JSON.stringify({ code: SYNC.code || "" })));
  } catch {
    /* Cache API unavailable (file:// or private mode) */
  }
}

/* ---------- the private part of sync, sealed on this device ---------- */

/** Additional data for the sealed state, so it can't be swapped with a sealed file. */
const STATE_AAD = "quest-log/state";

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** The state to upload: the shared part, with check-ins, notes and moments sealed into `vault`. */
async function sealedState(code: string): Promise<SharedState> {
  const { shared, secret } = splitState(S);
  const plain = new Uint8Array(new TextEncoder().encode(JSON.stringify(secret)));
  shared.vault = toB64(await seal(await vaultKey(code), STATE_AAD, plain, "application/json"));
  return shared;
}

/** Opens a downloaded state. Null if its sealed part can't be opened (it's then left untouched). */
async function openState(code: string, remote: SharedState): Promise<State | null> {
  if (!remote.vault) return mergeState(remote, null); // saved before encryption: nothing sealed yet
  try {
    const { data } = await unseal(await vaultKey(code), STATE_AAD, fromB64(remote.vault));
    const secret: unknown = JSON.parse(new TextDecoder().decode(data));
    return isPrivateBundle(secret) ? mergeState(remote, secret) : null;
  } catch {
    return null;
  }
}

export function apiFetch(path: string, opts: RequestInit = {}): Promise<Response> {
  const headers = new Headers(opts.headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  headers.set("Authorization", `Bearer ${SYNC.code ?? ""}`);
  return fetch(path, { ...opts, headers });
}

function setSyncStatus(s: SyncStatus): void {
  syncStatus = s;
  updateSyncUI();
}

function scheduleSync(): void {
  if (!SYNC.code) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => void pushState(), PUSH_DEBOUNCE_MS);
}

/** Uploads local state. A 409 means another device saved newer data, so pull instead. */
export async function pushState(force = false): Promise<void> {
  if (!SYNC.code) return;
  // A device that hasn't synced yet (just linked) must take the server's copy first, never overwrite it.
  if (!S.updatedAt && !force) {
    await pullState();
    return;
  }
  try {
    const res = await apiFetch("/api/state", {
      method: "PUT",
      body: JSON.stringify({
        state: await sealedState(SYNC.code),
        updatedAt: S.updatedAt || Date.now(),
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        force,
      }),
    });
    if (res.status === 409) {
      await pullState();
      return;
    }
    setSyncStatus(res.ok ? "synced" : "error");
  } catch {
    setSyncStatus("offline");
  }
}

/** Downloads server state if it's newer; uploads ours if ours is newer. */
export async function pullState(): Promise<void> {
  if (!SYNC.code) return;
  try {
    const res = await apiFetch("/api/state");
    if (res.status === 404) {
      await pushState(true); // first device: upload
      synced();
      return;
    }
    if (!res.ok) {
      setSyncStatus("error");
      return;
    }
    const remote = (await res.json()) as { state: SharedState; updatedAt?: number };
    const theirs = remote.updatedAt || 0;
    const ours = S.updatedAt || 0;
    if (theirs > ours) {
      // If the sealed part can't be opened, keep what's here rather than lose private data.
      const opened = await openState(SYNC.code, remote.state);
      if (!opened) {
        setSyncStatus("error");
        return;
      }
      setState(opened);
      S.updatedAt = theirs;
      saveLocal();
      applyTheme();
      render();
      processRewards();
    } else if (theirs < ours) {
      await pushState();
    }
    setSyncStatus("synced");
    synced();
  } catch {
    setSyncStatus("offline");
  }
}

function newCode(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64uToBytes(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export async function subscribePush(): Promise<boolean> {
  if (!SYNC.code || !("serviceWorker" in navigator) || !("PushManager" in window)) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    const { vapidPublicKey } = (await (await fetch("/api/config")).json()) as { vapidPublicKey: string };
    const sub =
      (await reg.pushManager.getSubscription()) ||
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(vapidPublicKey) }));
    const res = await apiFetch("/api/subscribe", { method: "POST", body: JSON.stringify({ endpoint: sub.endpoint }) });
    SYNC.push = res.ok;
  } catch (e) {
    console.warn(e);
    SYNC.push = false;
  }
  saveSync();
  updateSyncUI();
  return SYNC.push;
}

async function unsubscribePush(): Promise<void> {
  try {
    // getRegistration() answers at once; `ready` would wait forever where no service worker runs.
    const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await apiFetch("/api/subscribe", { method: "DELETE", body: JSON.stringify({ endpoint: sub.endpoint }) });
      await sub.unsubscribe();
    }
  } catch {
    /* best effort */
  }
  SYNC.push = false;
}

async function startSync(code: string): Promise<void> {
  SYNC = { code, push: false };
  saveSync();
  await pullState();
  if (hasNotif && Notification.permission === "granted") await subscribePush();
  updateSyncUI();
}

export function updateSyncUI(): void {
  const box = document.querySelector<HTMLElement>("#syncBox");
  if (!box) return;
  box.hidden = DEMO || !onServer();
  const on = !!SYNC.code;
  const pushText =
    SYNC.push ? "on"
    : hasNotif && Notification.permission === "granted" ? "not set up"
    : "turn on reminders above";
  $("#syncStatus").textContent =
    on ?
      `On${syncStatus ? " · " + syncStatus : ""} · account ${SYNC.code?.slice(0, 6)}. Push reminders: ${pushText}.`
    : "Off. Turn on to sync devices and get push reminders when the app is closed.";
  $("#syncOn").hidden = on;
  $("#syncLink").hidden = on;
  $("#syncShow").hidden = !on;
  $("#syncTest").hidden = !(on && SYNC.push);
  $("#syncOff").hidden = !on;
  $("#syncDelete").hidden = !on;
  if (!on) armDelete(false);
}

/* ---------- delete my data ---------- */

let deleteArmed = false;
function armDelete(armed: boolean): void {
  deleteArmed = armed;
  const btn = document.querySelector<HTMLButtonElement>("#syncDelete");
  if (!btn) return;
  btn.textContent = armed ? "Tap again: delete everything on the server" : "Delete my data from the server";
  btn.classList.toggle("armed", armed);
}

/** Removes this account from the server (state, reminders, backed-up files). This device keeps everything. */
async function deleteServerData(): Promise<void> {
  if (!deleteArmed) {
    armDelete(true);
    return;
  }
  armDelete(false);
  const ok = await apiFetch("/api/account", { method: "DELETE" }).then(
    (res) => res.ok,
    () => false, // offline, or the server didn't answer
  );
  if (!ok) {
    toast("sync", "Couldn't delete", "The server didn't answer. Nothing was changed; try again when you're online.");
    return;
  }
  await unsubscribePush();
  SYNC = {};
  saveSync();
  updateSyncUI();
  synced();
  toast("sync", "Deleted from the server", "Sync is off. Everything is still here on this device.");
}

export function initSync(): void {
  if (DEMO) {
    // The demo never talks to the server, and never touches the service worker's config (shared with the real app).
    $("#syncBox").hidden = true;
    return;
  }
  onSave(scheduleSync);
  $("#syncOn").onclick = async () => {
    await startSync(newCode());
    toast("sync", "Sync is on", "Use 'Show sync code' to link another device.");
  };
  $("#syncLink").onclick = async () => {
    const code = (prompt("Paste the sync code from your other device:") || "").trim();
    if (!CODE_RE.test(code)) {
      if (code) alert("That doesn't look like a sync code.");
      return;
    }
    S.updatedAt = 0; // let the server copy win
    await startSync(code);
    toast("sync", "Linked", "This device now shares your quests.");
  };
  $("#syncShow").onclick = async () => {
    try {
      await navigator.clipboard.writeText(SYNC.code || "");
      toast("sync", "Code copied", "Paste it into Quest Log on your other device. Keep it private.");
    } catch {
      prompt("Your sync code (keep it private):", SYNC.code);
    }
  };
  $("#syncTest").onclick = async () => {
    const res = await apiFetch("/api/test-push", { method: "POST" });
    const r = res.ok ? ((await res.json()) as { sent?: number }) : null;
    if (r?.sent) toast("push", "Test sent", "A notification should appear in a few seconds.");
    else toast("push", "Test failed", "Try turning reminders off and on again.");
  };
  $("#syncDelete").onclick = () => void deleteServerData();
  $("#syncOff").onclick = async () => {
    if (!confirm("Turn off sync on this device? Your quests stay here and on the server.")) return;
    await unsubscribePush();
    SYNC = {};
    saveSync();
    updateSyncUI();
    synced();
  };
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void pullState();
  });
  void writeSwConfig();
}
