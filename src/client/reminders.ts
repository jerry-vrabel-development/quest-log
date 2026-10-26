/**
 * In-app reminders (while the app is open) and the notification permission UI.
 * Push from the server takes over once sync is on.
 */
import { DEMO } from "./demo";
import { reminderFor, REMINDER_GRACE_MS } from "../core/reminders";
import { $ } from "./dom";
import { S, prefs, today } from "./store";
import { SYNC, subscribePush, updateSyncUI } from "./sync";
import { toast } from "./toast";

const NOTIFIED_KEY = "quest-log-notified";
const DISMISSED_KEY = "quest-log-notif-dismissed";
const FORGET_AFTER_MS = 14 * 86_400_000;

export const hasNotif = typeof window !== "undefined" && "Notification" in window;
const localTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

function loadNotified(): Record<string, number> {
  try {
    return JSON.parse(prefs.get(NOTIFIED_KEY) || "{}") as Record<string, number>;
  } catch {
    return {};
  }
}

export async function checkReminders(): Promise<void> {
  if (DEMO) return; // sample quests shouldn't buzz anyone's phone
  if (!hasNotif || Notification.permission !== "granted") return;
  if (SYNC.code && SYNC.push) return; // the server sends these
  const now = Date.now();
  const t = today();
  const tz = localTz();
  const sent = loadNotified();
  for (const q of S.quests) {
    const r = reminderFor(q, t, tz);
    if (!r || now < r.at || now > r.dueAt + REMINDER_GRACE_MS || sent[r.key]) continue;
    sent[r.key] = now;
    const body = q.tiny ? "Tiny step: " + q.tiny : `+${q.xp} XP waiting`;
    try {
      // navigator.serviceWorker is missing on insecure origins, whatever the DOM types say
      const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
      if (reg) {
        await reg.showNotification(q.name, {
          body,
          tag: r.key,
          icon: "icons/icon-192.png",
          badge: "icons/icon-192.png",
        });
      } else {
        new Notification(q.name, { body, tag: r.key });
      }
    } catch {
      /* notification blocked mid-session */
    }
  }
  const recent = Object.fromEntries(Object.entries(sent).filter(([, at]) => now - at <= FORGET_AFTER_MS));
  prefs.set(NOTIFIED_KEY, JSON.stringify(recent));
}

async function enableNotifications(): Promise<void> {
  if (!hasNotif) {
    alert("This browser doesn't support notifications. Use 'Send to my phone's calendar' in Settings instead.");
    return;
  }
  const p = await Notification.requestPermission();
  updateNotifUI();
  if (p !== "granted") return;
  if (SYNC.code) await subscribePush();
  toast(
    "reminders",
    "Reminders on",
    SYNC.push ?
      "Push reminders will reach you even when the app is closed."
    : "You'll get a nudge while the app is open.",
  );
  void checkReminders();
}

const STATUS: Record<NotificationPermission | "unsupported", string> = {
  granted: "On. For reminders when the app is fully closed, also export to your calendar.",
  denied: "Blocked in your browser settings. Use calendar export instead.",
  unsupported: "Not supported here. Use calendar export instead.",
  default: "Off.",
};

export function updateNotifUI(): void {
  const p = hasNotif ? Notification.permission : "unsupported";
  const anyScheduled = S.quests.some((q) => q.due && !q.done && q.remind >= 0);
  $("#notifBanner").hidden = !(p === "default" && anyScheduled) || prefs.get(DISMISSED_KEY) === "1";
  $("#notifStatus").textContent = STATUS[p];
  $("#notifBtn2").hidden = p !== "default";
  updateSyncUI();
}

export function initReminders(): void {
  $("#enableNotif").onclick = enableNotifications;
  $("#notifBtn2").onclick = enableNotifications;
  $("#dismissNotif").onclick = () => {
    prefs.set(DISMISSED_KEY, "1");
    updateNotifUI();
  };
}
