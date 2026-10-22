// @ts-check
/**
 * What happens when the user does something rewarding. The core rules change the state;
 * this module rolls loot, checks badges, saves, re-renders and queues the toasts.
 */
import { completeQuest, level, recordFreeze, recordMood, rollLoot, uncompleteQuest } from "./core/rules.js";
import { checkBadges } from "./core/stats.js";
import { render } from "./render.js";
import { S, save, when } from "./store.js";
import { toastQueue } from "./toast.js";

/** @typedef {import("./core/types.js").Quest} Quest */
/** @typedef {import("./toast.js").ToastItem} ToastItem */

/** @param {{ icon: string, name: string, desc: string }} b @returns {ToastItem} */
const badgeToast = (b) => ["badge", `${b.icon} ${b.name}`, b.desc];

/**
 * Rolls loot for XP just earned, checks badges, saves and celebrates.
 * @param {number} xp XP earned by the action (0 for a repeat mood check-in)
 * @param {number} levelBefore level before the action
 */
function reward(xp, levelBefore) {
  const item = xp > 0 ? rollLoot(S) : null;
  const badges = checkBadges(S, when());
  save();
  render();
  /** @type {ToastItem[]} */
  const toasts = [];
  const levelAfter = level(S.xp).l;
  if (levelAfter > levelBefore) toasts.push(["level up", `Level ${levelAfter}!`, "You're moving. Keep it gentle."]);
  if (item) toasts.push([item.rar, item.n, item.d]);
  toasts.push(...badges.map(badgeToast));
  if (!toasts.length && xp > 0) toasts.push([`+${xp} xp`, "Nice.", "No drop this time. The next one might be big."]);
  toastQueue(toasts);
}

/** @param {Quest} q @param {boolean} checked */
export function setQuestDone(q, checked) {
  const before = level(S.xp).l;
  if (checked) {
    reward(completeQuest(S, q, when()).xp, before);
  } else {
    uncompleteQuest(S, q);
    save();
    render();
  }
}

export function breakFreeze() {
  const before = level(S.xp).l;
  reward(recordFreeze(S, when()).xp, before);
}

/** @param {number} v 1-10 */
export function logMood(v) {
  const note = (prompt("Anything you want to remember about today? (optional)") || "").trim().slice(0, 280);
  const before = level(S.xp).l;
  reward(recordMood(S, v, note, when()).xp, before);
}

/** Quests completed through the Claude connector already have their XP; roll their loot here. */
export function processRewards() {
  if (!S.rewards?.length) return;
  const items = S.rewards.splice(0);
  /** @type {ToastItem[]} */
  const toasts = [
    [
      "claude",
      `${items.length} quest${items.length === 1 ? "" : "s"} completed with Claude`,
      items.map((r) => r.name).join(" · "),
    ],
  ];
  for (const _ of items) {
    const it = rollLoot(S);
    if (it) toasts.push([it.rar, it.n, it.d]);
  }
  toasts.push(...checkBadges(S, when()).map(badgeToast));
  save();
  render();
  toastQueue(toasts);
}
