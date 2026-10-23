/**
 * What happens when the user does something rewarding, in Karen Pryor's order:
 *   1. mark the behavior the instant it happens (a click and a tiny buzz),
 *   2. let the core rules change the state and decide how big the moment is,
 *   3. pay out: loot, badges, and a celebration sized to the moment.
 */
import { celebrationFor, guaranteedDrop, isLowDay, type Moment } from "../core/celebrate";
import { completeQuest, level, recordFreeze, recordMood, rollLoot, streak, uncompleteQuest } from "../core/rules";
import { checkBadges, type EarnedBadge } from "../core/stats";
import { comebackFor, type Comeback } from "../core/streaks";
import type { Quest } from "../core/types";
import { celebrate } from "./celebration";
import { render } from "./render";
import { buzz, playMarker } from "./sound";
import { S, save, today, when } from "./store";
import type { ToastItem } from "./toast";

const badgeToast = (b: EarnedBadge): ToastItem => ["badge", `${b.icon} ${b.name}`, b.desc];

/** Step 1: the marker. Runs before any work, so it lands within milliseconds of the tap. */
function mark(): void {
  playMarker();
  buzz("marker");
}

interface Before {
  level: number;
  streak: number;
  /** Taken before the rule marks today active, so a comeback can be detected. */
  comeback: Comeback | null;
}
const snapshot = (): Before => ({
  level: level(S.xp).l,
  streak: streak(S.days, today()),
  comeback: comebackFor(S.days, today()),
});
const questsToday = () => S.log.filter((e) => e.t === "quest" && e.day === today()).length;

/** Steps 2 and 3: roll loot, check badges, save, render, and celebrate. */
function reward(
  before: Before,
  { kind, xp, questXp, repeatCount = 0 }: { kind: Moment["kind"]; xp: number; questXp?: number; repeatCount?: number },
): void {
  const t = today();
  const lowDay = isLowDay(S.moods, t);
  const comeback = xp > 0 ? before.comeback : null;
  const item =
    xp > 0 ? rollLoot(S, Math.random, Date.now(), guaranteedDrop({ repeatCount, lowDay, comeback: !!comeback })) : null;
  const badges = checkBadges(S, when());
  save();
  render();

  const levelAfter = level(S.xp).l;
  const celebration = celebrationFor({
    kind,
    xp,
    questXp,
    item,
    badges: badges.map((b) => `${b.icon} ${b.name}`),
    levelBefore: before.level,
    levelAfter,
    streakBefore: before.streak,
    streakAfter: streak(S.days, t),
    questsToday: questsToday(),
    lowDay,
    comeback,
  });

  const toasts: ToastItem[] = [];
  if (levelAfter > before.level) toasts.push(["level up", `Level ${levelAfter}!`, "You're moving. Keep it gentle."]);
  if (item) toasts.push([item.rar, item.n, item.d]);
  toasts.push(...badges.map(badgeToast));
  if (!toasts.length && xp > 0) toasts.push([`+${xp} xp`, "Nice.", "No drop this time. The next one might be big."]);
  celebrate({ celebration, item, toasts });
}

export function setQuestDone(q: Quest, checked: boolean): void {
  if (!checked) {
    uncompleteQuest(S, q);
    save();
    render();
    return;
  }
  mark();
  const before = snapshot();
  const { xp } = completeQuest(S, q, when());
  reward(before, { kind: "quest", xp, questXp: q.xp, repeatCount: q.repeat !== "none" ? q.count : 0 });
}

/** The two minutes are done (the dice already played the marker when they started). */
export function finishFreeze(step?: string): void {
  mark();
  const before = snapshot();
  reward(before, { kind: "freeze", xp: recordFreeze(S, when(), step).xp });
}

export function logMood(v: number): void {
  mark();
  const note = (prompt("Anything you want to remember about today? (optional)") || "").trim().slice(0, 280);
  const before = snapshot();
  reward(before, { kind: "mood", xp: recordMood(S, v, note, when()).xp });
}

/** Quests completed through the Claude connector already have their XP; roll their loot here. */
export function processRewards(): void {
  if (!S.rewards?.length) return;
  const items = S.rewards.splice(0);
  const lowDay = isLowDay(S.moods, today());
  const toasts: ToastItem[] = [
    [
      "claude",
      `${items.length} quest${items.length === 1 ? "" : "s"} completed with Claude`,
      items.map((r) => r.name).join(" · "),
    ],
  ];
  const drops = items.map(() => rollLoot(S, Math.random, Date.now(), lowDay)).filter((it) => it !== null);
  for (const it of drops) toasts.push([it.rar, it.n, it.d]);
  const badges = checkBadges(S, when());
  toasts.push(...badges.map(badgeToast));
  save();
  render();

  // Celebrate the best moment in the batch, judged by the same rules as a single quest.
  const best = drops.find((d) => d.rar === "legendary") ?? drops.find((d) => d.rar === "epic") ?? drops.at(0) ?? null;
  const lvl = level(S.xp).l;
  const celebration = celebrationFor({
    kind: "freeze", // not a quest done in the app, so no big-day or hard-day bonuses here
    xp: items.reduce((sum, r) => sum + r.xp, 0),
    item: best,
    badges: badges.map((b) => `${b.icon} ${b.name}`),
    levelBefore: lvl,
    levelAfter: lvl,
    streakBefore: 0,
    streakAfter: 0,
    questsToday: 0,
    lowDay,
  });
  celebrate({ celebration, item: best, toasts });
}
