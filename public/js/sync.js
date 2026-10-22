// @ts-check
/**
 * Device sync and push subscription against the Cloudflare Worker.
 * The sync code is a random 256-bit secret; the server only ever sees it as a bearer token
 * and stores its SHA-256 hash. Conflicts are last-write-wins with a 409 guard.
 */
import { processRewards } from "./actions.js";
import { $ } from "./dom.js";
import { hasNotif } from "./reminders.js";
import { render } from "./render.js";
import { applyTheme } from "./settings.js";
import { S, onSave, prefs, saveLocal, setState } from "./store.js";
import { toast } from "./toast.js";

const SYNC_KEY = "quest-log-sync";
const CONFIG_CACHE = "quest-log-config"; // read by the service worker to fetch the push outbox
const PUSH_DEBOUNCE_MS = 1200;
export const CODE_RE = /^[A-Za-z0-9_-]{32,128}$/;

/** @type {{ code?: string, push?: boolean }} */
export let SYNC = (() => {
  try {
    return JSON.parse(prefs.get(SYNC_KEY) || "{}") || {};
  } catch {
    return {};
  }
})();

/** "synced" | "offline" | "error" | "" */
let syncState = "";
/** @type {ReturnType<typeof setTimeout> | undefined} */
let pushTimer;

const onServer = () => location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname);

function saveSync() {
  prefs.set(SYNC_KEY, JSON.stringify(SYNC));
  writeSwConfig();
}

export async function writeSwConfig() {
  try {
    const c = await caches.open(CONFIG_CACHE);
    await c.put("/__config", new Response(JSON.stringify({ code: SYNC.code || "" })));
  } catch {
    /* Cache API unavailable (file:// or private mode) */
  }
}

/** @param {string} path @param {RequestInit} [opts] */
function apiFetch(path, opts = {}) {
  return fetch(path, {
    ...opts,
    headers: { "content-type": "application/json", Authorization: "Bearer " + SYNC.code, ...(opts.headers || {}) },
  });
}

/** @param {string} s */
function setSyncState(s) {
  syncState = s;
  updateSyncUI();
}

function scheduleSync() {
  if (!SYNC.code) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => pushState(), PUSH_DEBOUNCE_MS);
}

/** Uploads local state. A 409 means another device saved newer data, so pull instead. */
export async function pushState(force = false) {
  if (!SYNC.code) return;
  try {
    const res = await apiFetch("/api/state", {
      method: "PUT",
      body: JSON.stringify({
        state: S,
        updatedAt: S.updatedAt || Date.now(),
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        force,
      }),
    });
    if (res.status === 409) return pullState();
    setSyncState(res.ok ? "synced" : "error");
  } catch {
    setSyncState("offline");
  }
}

/** Downloads server state if it's newer; uploads ours if ours is newer. */
export async function pullState() {
  if (!SYNC.code) return;
  try {
    const res = await apiFetch("/api/state");
    if (res.status === 404) return pushState(true); // first device: upload
    if (!res.ok) return setSyncState("error");
    const remote = await res.json();
    const theirs = remote.updatedAt || 0;
    const ours = S.updatedAt || 0;
    if (theirs > ours) {
      setState(remote.state);
      S.updatedAt = theirs;
      saveLocal();
      applyTheme();
      render();
      processRewards();
    } else if (theirs < ours) {
      await pushState();
    }
    setSyncState("synced");
  } catch {
    setSyncState("offline");
  }
}

function newCode() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** @param {string} s base64url */
function b64uToBytes(s) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export async function subscribePush() {
  if (!SYNC.code || !("serviceWorker" in navigator) || !("PushManager" in window)) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    const { vapidPublicKey } = await (await fetch("/api/config")).json();
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

async function unsubscribePush() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await apiFetch("/api/subscribe", { method: "DELETE", body: JSON.stringify({ endpoint: sub.endpoint }) });
      await sub.unsubscribe();
    }
  } catch {
    /* best effort */
  }
  SYNC.push = false;
}

/** @param {string} code */
async function startSync(code) {
  SYNC = { code, push: false };
  saveSync();
  await pullState();
  if (hasNotif && Notification.permission === "granted") await subscribePush();
  updateSyncUI();
}

export function updateSyncUI() {
  const box = $("#syncBox");
  if (!box) return;
  box.hidden = !onServer();
  const on = !!SYNC.code;
  const pushText =
    SYNC.push ? "on"
    : hasNotif && Notification.permission === "granted" ? "not set up"
    : "turn on reminders above";
  $("#syncStatus").textContent =
    !on ?
      "Off. Turn on to sync devices and get push reminders when the app is closed."
    : `On${syncState ? " · " + syncState : ""} · account ${SYNC.code?.slice(0, 6)}. Push reminders: ${pushText}.`;
  $("#syncOn").hidden = on;
  $("#syncLink").hidden = on;
  $("#syncShow").hidden = !on;
  $("#syncTest").hidden = !(on && SYNC.push);
  $("#syncOff").hidden = !on;
}

export function initSync() {
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
    const r = res.ok ? await res.json() : null;
    if (r?.sent) toast("push", "Test sent", "A notification should appear in a few seconds.");
    else toast("push", "Test failed", "Try turning reminders off and on again.");
  };
  $("#syncOff").onclick = async () => {
    if (!confirm("Turn off sync on this device? Your quests stay here and on the server.")) return;
    await unsubscribePush();
    SYNC = {};
    saveSync();
    updateSyncUI();
  };
  document.addEventListener("visibilitychange", () => !document.hidden && pullState());
  writeSwConfig();
}
