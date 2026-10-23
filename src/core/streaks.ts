/**
 * Streak history and comebacks.
 *
 * Streaks build investment, and holding one is hard, so they stay. But a streak ending is never a
 * punishment: the run is honored ("in the record"), and coming back after a break is its own reward
 * moment, because returning is the hardest step on a frozen week (design principle 6).
 */
import { addDays } from "./dates";

export interface Run {
  start: string;
  end: string;
  length: number;
}

/** Every run of consecutive active days, oldest first. */
export function runs(days: string[]): Run[] {
  const out: Run[] = [];
  for (const d of [...new Set(days)].sort()) {
    const last = out.at(-1);
    if (last && addDays(last.end, 1) === d) {
      last.end = d;
      last.length++;
    } else out.push({ start: d, end: d, length: 1 });
  }
  return out;
}

export interface Comeback {
  /** Days missed between the last active day and today. */
  gapDays: number;
  /** Length of the run that ended before the break. */
  endedRun: number;
  /** 1 = the longest run ever (ties share a rank), 2 = second-longest, and so on. */
  rank: number;
}

/**
 * Whether acting today is a comeback: there was activity before, but not today and not yesterday.
 * Pass the active days as they were *before* today's action.
 */
export function comebackFor(daysBefore: string[], today: string): Comeback | null {
  const past = runs(daysBefore.filter((d) => d < today));
  const last = past.at(-1);
  if (!last || daysBefore.includes(today) || last.end === addDays(today, -1)) return null;
  let gapDays = 0;
  for (let d = addDays(last.end, 1); d < today; d = addDays(d, 1)) gapDays++;
  const rank = 1 + new Set(past.filter((r) => r.length > last.length).map((r) => r.length)).size;
  return { gapDays, endedRun: last.length, rank };
}

/** How many times activity resumed after a break. */
export const countComebacks = (days: string[]): number => Math.max(0, runs(days).length - 1);

/** "Your 12-day streak is in the record, your second-longest." Null for a single day. */
export function honorEndedRun({ endedRun, rank }: Comeback): string | null {
  if (endedRun < 2) return null;
  const which = ["your longest", "your second-longest", "your third-longest"][rank - 1];
  return `Your ${String(endedRun)}-day streak is in the record${which ? `, ${which}` : ""}.`;
}
