/**
 * The demo's sample life: five weeks of a person using Quest Log, played through the real rules
 * (completeQuest, recordMood, rollLoot, checkBadges, ...) with a seeded random number generator,
 * so every number in the demo is consistent and the same on every visit.
 *
 * The story: twelve good days, a five-day break, a comeback, and a run that's still going today.
 * Some hard days (and quests finished on them anyway), notes from past you, a few moments, check-ins
 * with extras. Nothing is from a real person.
 */
import { addDays } from "./dates";
import { addNote } from "./memories";
import { addMoment } from "./moments";
import { completeQuest, recordFreeze, recordMood, rollLoot } from "./rules";
import { freshState, normalizeQuest } from "./state";
import { checkBadges } from "./stats";
import type { Extras } from "./checkin";
import type { Moment, Quest, State } from "./types";

export const DEMO_DAYS = 35;

/** Moments in the demo that carry a picture, drawn on the device when the demo starts. */
export const DEMO_PHOTOS = [
  { id: "demo-photo-lake", scene: "lake" },
  { id: "demo-photo-trail", scene: "trail" },
] as const;
export type DemoScene = (typeof DEMO_PHOTOS)[number]["scene"];

/** A small seeded PRNG (mulberry32): the same demo for everyone, every time. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Milliseconds for a local date and hour, e.g. ("2026-10-20", 9.5) → 9:30 AM that day. */
const at = (day: string, hour: number): number => {
  const [y = 0, m = 1, d = 1] = day.split("-").map(Number);
  return new Date(y, m - 1, d, Math.floor(hour), Math.round((hour % 1) * 60)).getTime();
};

const isWeekday = (day: string) => {
  const dow = new Date(at(day, 12)).getDay();
  return dow > 0 && dow < 6;
};

type Spec = Pick<Quest, "g" | "name" | "tiny" | "xp"> & Partial<Pick<Quest, "time" | "repeat">>;

/** The quests this person keeps. */
const ROUTINE: Spec[] = [
  { g: "Bash", name: "Walk Bash", tiny: "Leash on, out the door", xp: 10, time: "08:00", repeat: "daily" },
  { g: "Health", name: "Drink a glass of water", tiny: "Fill the glass", xp: 5, time: "09:00", repeat: "daily" },
  { g: "Career", name: "Apply to one job", tiny: "Open one listing and read it", xp: 20, repeat: "weekdays" },
  { g: "Art", name: "Play guitar for ten minutes", tiny: "Pick it up, tune one string", xp: 10, repeat: "daily" },
];

/** One-off wins scattered through the weeks. */
const ONE_OFFS: Spec[] = [
  { g: "Career", name: "Update the resume summary", tiny: "Open the file", xp: 15 },
  { g: "Home", name: "Clear the kitchen table", tiny: "Pick up three things", xp: 15 },
  { g: "Career", name: "Message a former coworker", tiny: "Open their profile", xp: 15 },
  { g: "Health", name: "Refill prescriptions", tiny: "Find the pharmacy number", xp: 20 },
  { g: "Bash", name: "Book Bash's vet checkup", tiny: "Look up the vet's hours", xp: 15 },
  { g: "Career", name: "Finish the portfolio README", tiny: "Write one sentence", xp: 30 },
  { g: "Home", name: "Do one load of laundry", tiny: "Carry the basket to the machine", xp: 10 },
  { g: "Career", name: "Prep for the phone screen", tiny: "Read the job post again", xp: 25 },
  { g: "Health", name: "Go to bed before midnight", tiny: "Phone on the charger", xp: 10 },
  { g: "Art", name: "Learn the bridge of the new song", tiny: "Play the first two chords", xp: 15 },
];

/** What's waiting today: a few open quests so the Now view has something to check off. */
const OPEN: Spec[] = [
  { g: "Career", name: "Follow up on Friday's application", tiny: "Find the recruiter's email", xp: 15 },
  { g: "Home", name: "Take out the recycling", tiny: "Grab the bin by the door", xp: 10 },
  { g: "Health", name: "Go outside for five minutes", tiny: "Shoes on, open the door", xp: 10 },
];

/** Days (counted back from today) and the shape of each: the story above, day by day. */
interface DayPlan {
  mood: number;
  extras?: Extras;
  note?: string;
  routine: number; // how many routine quests got done
  oneOff?: boolean;
  freeze?: string;
}

function plan(back: number, rnd: () => number): DayPlan | null {
  if (back <= 23 && back >= 19) return null; // the break: five days with nothing logged
  const hard = [31, 27, 15, 9].includes(back);
  if (hard) {
    return {
      mood: back === 15 ? 3 : 4,
      extras: { anxiety: 4, energy: 1, sleep: back === 9 ? "4 hours, woke at 3" : "5 hours" },
      note: back === 15 ? "heavy day" : "",
      routine: 1,
      freeze: back === 27 ? "Leash on, out the door" : undefined,
    };
  }
  const mood = 5 + Math.floor(rnd() * 4); // 5-8
  const good = mood >= 7;
  return {
    mood,
    extras: rnd() < 0.5 ? { energy: good ? 4 : 3, focus: good ? 4 : 2, anxiety: good ? 2 : 3 } : undefined,
    note:
      good && rnd() < 0.5 ?
        (["Good walk by the lake", "Got a reply from a recruiter", "Played the whole song through"][
          Math.floor(rnd() * 3)
        ] ?? "")
      : "",
    routine: 2 + Math.floor(rnd() * 3),
    oneOff: rnd() < 0.45,
  };
}

/** Builds the demo state for `today`. Pictures for photo moments are drawn separately (DEMO_PHOTOS). */
export function demoState(today: string): State {
  const rnd = prng(20261026);
  const S = freshState(today);
  S.quests = [];
  S.nextId = 1;
  const add = (spec: Spec, due: string): Quest => {
    const q = normalizeQuest({ ...spec, due, remind: -1 }, S.nextId++);
    S.quests.push(q);
    return q;
  };
  const start = addDays(today, -DEMO_DAYS);
  const routine = ROUTINE.map((s) => add(s, start));
  const oneOffs = [...ONE_OFFS];

  for (let back = DEMO_DAYS; back >= 1; back--) {
    const day = addDays(today, -back);
    const p = plan(back, rnd);
    if (!p) continue;
    let hour = 8;
    const when = () => ({ today: day, now: at(day, (hour += 0.75)) });
    const lowDay = p.mood <= 4;

    recordMood(S, p.mood, p.note ?? "", when(), p.extras ?? {});
    if (p.freeze) recordFreeze(S, when(), p.freeze);

    const todays = routine.filter((q) => q.repeat !== "weekdays" || isWeekday(day)).slice(0, p.routine);
    for (const q of todays) {
      if (q.due < day) q.due = day; // missed days roll forward, as in the app
      completeQuest(S, q, when());
      rollLoot(S, rnd, at(day, hour), lowDay);
    }
    if (p.oneOff && oneOffs.length) {
      const spec = oneOffs.shift();
      if (spec) {
        const q = add(spec, day);
        completeQuest(S, q, when());
        rollLoot(S, rnd, at(day, hour), lowDay);
      }
    }
    checkBadges(S, when());

    if (back === 33) addNote(S, "You've come back before. You will again.", when());
    if (back === 12) addNote(S, "Bash doesn't care how the job search is going. Walk him. Start there.", when());
    if (back === 12)
      moment(S, { id: "demo-photo-lake", kind: "photo", caption: "Bash at the lake, golden hour", area: "Bash" }, day);
    if (back === 25)
      moment(S, { id: "demo-song", kind: "song", caption: "On repeat all week", title: "Harvest Moon" }, day);
    if (back === 6)
      moment(
        S,
        { id: "demo-photo-trail", kind: "photo", caption: "First cold morning on the trail", area: "Health" },
        day,
      );
    if (back === 4)
      moment(
        S,
        { id: "demo-movie", kind: "movie", caption: "Laughed out loud. Needed that.", title: "Paddington 2" },
        day,
      );
  }

  for (const q of routine) if (q.due < today) q.due = today;
  for (const spec of OPEN) add(spec, today);
  S.memSeen = [];
  S.updatedAt = 0; // never "newer" than anything: the demo doesn't sync anyway
  return S;
}

function moment(S: State, m: Omit<Moment, "at" | "day">, day: string): void {
  addMoment(S, { ...m, at: at(day, 19), day });
}
