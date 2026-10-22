import { describe, expect, it } from "vitest";
import { buildIcs, icsEscape, icsFold, slug } from "../../public/js/core/ics.js";
import { quest } from "../helpers/fixtures.js";

const NOW = Date.UTC(2026, 9, 22, 12);
const lines = (ics) => ics.split("\r\n");

describe("buildIcs", () => {
  it("wraps events in a calendar and skips undated or finished quests", () => {
    const ics = buildIcs([quest(1, { due: "2026-10-23" }), quest(2), quest(3, { due: "2026-10-23", done: true })], NOW);
    const l = lines(ics);
    expect(l[0]).toBe("BEGIN:VCALENDAR");
    expect(l.at(-1)).toBe("END:VCALENDAR");
    expect(l.filter((x) => x === "BEGIN:VEVENT")).toHaveLength(1);
    expect(ics).toContain("DTSTAMP:20261022T120000Z");
  });

  it("timed quests are 30-minute events", () => {
    const l = lines(buildIcs([quest(1, { due: "2026-10-23", time: "09:15" })], NOW));
    expect(l).toContain("DTSTART:20261023T091500");
    expect(l).toContain("DTEND:20261023T094500");
  });

  it("a late-night event ends the next day instead of before it starts", () => {
    const l = lines(buildIcs([quest(1, { due: "2026-10-23", time: "23:45" })], NOW));
    expect(l).toContain("DTEND:20261024T001500");
  });

  it("untimed quests are all-day events with the alarm moved to 9am", () => {
    const l = lines(buildIcs([quest(1, { due: "2026-10-23", remind: 0 })], NOW));
    expect(l).toContain("DTSTART;VALUE=DATE:20261023");
    expect(l).toContain("DTEND;VALUE=DATE:20261024");
    expect(l).toContain("TRIGGER:PT540M");
  });

  it("adds repeat rules and alarms, and no alarm when reminders are off", () => {
    const on = buildIcs([quest(1, { due: "2026-10-23", time: "10:00", repeat: "weekdays", remind: 15 })], NOW);
    expect(on).toContain("RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
    expect(on).toContain("TRIGGER:-PT15M");
    const off = buildIcs([quest(1, { due: "2026-10-23", remind: -1 })], NOW);
    expect(off).not.toContain("VALARM");
  });
});

describe("helpers", () => {
  it("escapes RFC 5545 special characters", () => {
    expect(icsEscape("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");
  });

  it("folds long lines with a leading space", () => {
    const folded = icsFold("X".repeat(160));
    const parts = folded.split("\r\n");
    expect(parts.every((p) => p.length <= 75)).toBe(true);
    expect(parts.slice(1).every((p) => p.startsWith(" "))).toBe(true);
    expect(parts.map((p, i) => (i ? p.slice(1) : p)).join("")).toBe("X".repeat(160));
  });

  it("makes file-safe slugs", () => {
    expect(slug("Call 211 about housing & food!")).toBe("call-211-about-housing-food");
    expect(slug("!!!")).toBe("quest");
  });
});
