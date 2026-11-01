/**
 * What happens when the user does something rewarding, in Karen Pryor's order:
 *   1. mark the behavior the instant it happens (a click and a tiny buzz),
 *   2. let the core rules change the state and decide how big the moment is,
 *   3. pay out: loot, badges, and a celebration sized to the moment.
 */
import type { Extras } from "../core/checkin";
import { celebrationFor, guaranteedDrop, isLowDay, type Moment, type Tier } from "../core/celebrate";
import {
  completeQuest,
  level,
  newTitle,
  recordFreeze,
  recordMood,
  rollLoot,
  streak,
  uncompleteQuest,
} from "../core/rules";
import { chooseMemory, markSeen, memoryChance, type Memory } from "../core/memories";
import { companionFor, handedBy, timesFound } from "../core/party";
import { checkBadges, type EarnedBadge } from "../core/stats";
import { comebackFor, type Comeback } from "../core/streaks";
import type { LootItem, Quest } from "../core/types";
import { celebrate } from "./celebration";
import { inviteMoment, momentAvailable } from "./moments";
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

/**
 * Sometimes a reward also brings back a memory from your own record, chosen for the moment.
 * Hard days always do, even for a second mood check-in that earns no XP.
 */
function pickMemory(m: {
  kind: Moment["kind"];
  xp: number;
  tier: Tier;
  lowDay: boolean;
  area?: string;
}): Memory | null {
  if (m.xp <= 0 && !(m.kind === "mood" && m.lowDay)) return null;
  // In the demo every reward brings a memory, so visitors see one right away; normally it's sometimes.
  if (Math.random() >= memoryChance(m.tier, m.lowDay)) return null;
  const memory = chooseMemory(S, {
    today: today(),
    lowDay: m.lowDay,
    tier: m.tier,
    area: m.area,
    available: momentAvailable,
  });
  if (memory) markSeen(S, memory);
  return memory;
}

/** A drop as a toast: who handed it over, and "found again" when it's a repeat. */
function lootToast(item: LootItem): ToastItem {
  const times = timesFound(S.inv, item.n);
  const title = times > 1 ? `${item.n} · found again ×${String(times)}` : item.n;
  return [item.rar, title, item.d, handedBy(item) ?? undefined];
}

/** Steps 2 and 3: roll loot, check badges, pick a memory, save, render, and celebrate. */
function reward(
  before: Before,
  {
    kind,
    xp,
    questXp,
    repeatCount = 0,
    area,
    mood,
  }: { kind: Moment["kind"]; xp: number; questXp?: number; repeatCount?: number; area?: string; mood?: number },
): void {
  const t = today();
  const lowDay = isLowDay(S.moods, t);
  const comeback = xp > 0 ? before.comeback : null;
  // Quests get loot from their area's companion; check-ins and Frozen? from the Guide (#31).
  const by = kind === "quest" ? companionFor(area).id : "guide";
  const item =
    xp > 0 ?
      rollLoot(S, Math.random, Date.now(), guaranteedDrop({ repeatCount, lowDay, comeback: !!comeback }), by)
    : null;
  const badges = checkBadges(S, when());

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
  const memory = pickMemory({ kind, xp, tier: celebration.tier, lowDay, area });
  // Capture when it's good: invite saving a moment after a 7+ check-in, a jackpot or a comeback.
  if ((mood ?? 0) >= 7 || celebration.tier === "jackpot" || comeback) inviteMoment();
  save();
  render();

  const toasts: ToastItem[] = [];
  if (levelAfter > before.level) {
    const title = newTitle(before.level, levelAfter);
    toasts.push([
      "level up",
      `Level ${String(levelAfter)}!`,
      title ? `You're a ${title} now.` : "You're moving. Keep it gentle.",
    ]);
  }
  if (item) toasts.push(lootToast(item));
  toasts.push(...badges.map(badgeToast));
  if (!toasts.length && xp > 0) toasts.push([`+${xp} xp`, "Nice.", "No drop this time. The next one might be big."]);
  celebrate({ celebration, item, toasts, memory });
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
  reward(before, { kind: "quest", xp, questXp: q.xp, repeatCount: q.repeat !== "none" ? q.count : 0, area: q.g });
}

/** The two minutes are done (the dice already played the marker when they started). */
export function finishFreeze(step?: string): void {
  mark();
  const before = snapshot();
  reward(before, { kind: "freeze", xp: recordFreeze(S, when(), step).xp });
}

/** Records a check-in from the Log dialog: the click first, then the reward. */
export function logMood(v: number, note: string, extras: Extras & { media?: string } = {}): void {
  mark();
  const before = snapshot();
  reward(before, { kind: "mood", xp: recordMood(S, v, note.trim().slice(0, 280), when(), extras).xp, mood: v });
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
  const drops = items
    .map((r) => rollLoot(S, Math.random, Date.now(), lowDay, companionFor(r.g).id))
    .filter((it) => it !== null);
  for (const it of drops) toasts.push(lootToast(it));
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
