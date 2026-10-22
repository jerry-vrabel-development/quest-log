/**
 * What happens when the user does something rewarding. The core rules change the state;
 * this module rolls loot, checks badges, saves, re-renders and queues the toasts.
 */
import { completeQuest, level, recordFreeze, recordMood, rollLoot, uncompleteQuest } from "../core/rules";
import { checkBadges, type EarnedBadge } from "../core/stats";
import type { Quest } from "../core/types";
import { render } from "./render";
import { S, save, when } from "./store";
import { toastQueue, type ToastItem } from "./toast";

const badgeToast = (b: EarnedBadge): ToastItem => ["badge", `${b.icon} ${b.name}`, b.desc];

/**
 * Rolls loot for XP just earned, checks badges, saves and celebrates.
 * @param xp XP earned by the action (0 for a repeat mood check-in)
 * @param levelBefore level before the action
 */
function reward(xp: number, levelBefore: number): void {
  const item = xp > 0 ? rollLoot(S) : null;
  const badges = checkBadges(S, when());
  save();
  render();
  const toasts: ToastItem[] = [];
  const levelAfter = level(S.xp).l;
  if (levelAfter > levelBefore) toasts.push(["level up", `Level ${levelAfter}!`, "You're moving. Keep it gentle."]);
  if (item) toasts.push([item.rar, item.n, item.d]);
  toasts.push(...badges.map(badgeToast));
  if (!toasts.length && xp > 0) toasts.push([`+${xp} xp`, "Nice.", "No drop this time. The next one might be big."]);
  toastQueue(toasts);
}

export function setQuestDone(q: Quest, checked: boolean): void {
  const before = level(S.xp).l;
  if (checked) {
    reward(completeQuest(S, q, when()).xp, before);
  } else {
    uncompleteQuest(S, q);
    save();
    render();
  }
}

export function breakFreeze(): void {
  const before = level(S.xp).l;
  reward(recordFreeze(S, when()).xp, before);
}

export function logMood(v: number): void {
  const note = (prompt("Anything you want to remember about today? (optional)") || "").trim().slice(0, 280);
  const before = level(S.xp).l;
  reward(recordMood(S, v, note, when()).xp, before);
}

/** Quests completed through the Claude connector already have their XP; roll their loot here. */
export function processRewards(): void {
  if (!S.rewards?.length) return;
  const items = S.rewards.splice(0);
  const toasts: ToastItem[] = [
    [
      "claude",
      `${items.length} quest${items.length === 1 ? "" : "s"} completed with Claude`,
      items.map((r) => r.name).join(" · "),
    ],
  ];
  for (let i = 0; i < items.length; i++) {
    const it = rollLoot(S);
    if (it) toasts.push([it.rar, it.n, it.d]);
  }
  toasts.push(...checkBadges(S, when()).map(badgeToast));
  save();
  render();
  toastQueue(toasts);
}
