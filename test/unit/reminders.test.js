import { describe, expect, it } from "vitest";
import { REMINDER_GRACE_MS, dueReminders, reminderFor } from "../../public/js/core/reminders.js";
import { quest } from "../helpers/fixtures.js";

const TZ = "America/Chicago";
const at = (iso) => Date.parse(iso);

describe("reminderFor", () => {
  it("defaults to 9:00 AM local time", () => {
    const r = reminderFor(quest(1, { due: "2026-10-22" }), "2026-10-22", TZ);
    expect(r).toEqual({ key: "1@2026-10-22", at: at("2026-10-22T14:00:00Z"), dueAt: at("2026-10-22T14:00:00Z") });
  });

  it("fires `remind` minutes early", () => {
    const r = reminderFor(quest(1, { due: "2026-10-22", time: "18:30", remind: 60 }), "2026-10-22", TZ);
    expect(r?.at).toBe(at("2026-10-22T22:30:00Z"));
  });

  it("is off for -1, undated or finished quests", () => {
    expect(reminderFor(quest(1, { due: "2026-10-22", remind: -1 }), "2026-10-22", TZ)).toBeNull();
    expect(reminderFor(quest(1), "2026-10-22", TZ)).toBeNull();
    expect(reminderFor(quest(1, { due: "2026-10-22", done: true }), "2026-10-22", TZ)).toBeNull();
  });

  it("uses the current occurrence of a missed repeating quest", () => {
    const r = reminderFor(quest(1, { due: "2026-10-15", repeat: "daily" }), "2026-10-22", TZ);
    expect(r?.key).toBe("1@2026-10-22");
  });
});

describe("dueReminders", () => {
  const state = {
    quests: [
      quest(1, { name: "Walk", tiny: "Leash on", due: "2026-10-22", time: "09:00" }),
      quest(2, { due: "2026-10-23" }),
    ],
  };

  it("returns nothing before the reminder time", () => {
    expect(dueReminders(state, TZ, at("2026-10-22T13:59:00Z"))).toEqual([]);
  });

  it("returns the reminder with its tiny step once it's time", () => {
    expect(dueReminders(state, TZ, at("2026-10-22T14:00:00Z"))).toEqual([
      { key: "1@2026-10-22", title: "Walk", body: "Tiny step: Leash on" },
    ]);
  });

  it("gives up after the grace period", () => {
    expect(dueReminders(state, TZ, at("2026-10-22T14:00:00Z") + REMINDER_GRACE_MS + 1)).toEqual([]);
  });

  it("falls back to the XP when there's no tiny step", () => {
    const [r] = dueReminders({ quests: [quest(3, { due: "2026-10-22", xp: 25 })] }, TZ, at("2026-10-22T15:00:00Z"));
    expect(r.body).toBe("+25 XP waiting");
  });
});
