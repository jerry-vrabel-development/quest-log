import { describe, expect, it } from "vitest";
import {
  addDays,
  advance,
  daysBetween,
  isValidTimeZone,
  isValidYmd,
  localYmd,
  nextOccurrence,
  rollForward,
  zonedTimeToUtc,
} from "../../public/js/core/dates.js";

describe("addDays / daysBetween", () => {
  it("crosses month and year boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
  });

  it("is unaffected by DST transitions", () => {
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
  });

  it("counts backwards as negative", () => {
    expect(daysBetween("2026-10-22", "2026-10-15")).toBe(-7);
  });
});

describe("advance", () => {
  it.each([
    ["daily", "2026-10-22", "2026-10-23"],
    ["weekly", "2026-10-22", "2026-10-29"],
    ["weekdays", "2026-10-23", "2026-10-26"], // Friday → Monday
    ["weekdays", "2026-10-24", "2026-10-26"], // Saturday → Monday
    ["monthly", "2026-10-22", "2026-11-22"],
    ["monthly", "2026-12-15", "2027-01-15"],
  ])("%s from %s is %s", (repeat, from, to) => {
    expect(advance(from, repeat)).toBe(to);
  });

  it("clamps monthly repeats to the end of shorter months", () => {
    expect(advance("2026-01-31", "monthly")).toBe("2026-02-28");
    expect(advance("2028-01-31", "monthly")).toBe("2028-02-29");
    expect(advance("2026-03-31", "monthly")).toBe("2026-04-30");
  });

  it("advances a day for an unknown rule, so loops always terminate", () => {
    expect(advance("2026-10-22", "fortnightly")).toBe("2026-10-23");
    expect(advance("2026-10-22", "none")).toBe("2026-10-23");
  });
});

describe("rollForward / nextOccurrence", () => {
  it("rollForward keeps a date that is already today or later", () => {
    expect(rollForward("2026-10-22", "daily", "2026-10-22")).toBe("2026-10-22");
    expect(rollForward("2026-10-30", "weekly", "2026-10-22")).toBe("2026-10-30");
  });

  it("rollForward lands on the first occurrence on or after today", () => {
    expect(rollForward("2026-10-01", "daily", "2026-10-22")).toBe("2026-10-22");
    expect(rollForward("2026-10-01", "weekly", "2026-10-22")).toBe("2026-10-22");
    expect(rollForward("2026-10-02", "weekly", "2026-10-22")).toBe("2026-10-23");
  });

  it("nextOccurrence is strictly after today, skipping missed days", () => {
    expect(nextOccurrence("2026-10-22", "daily", "2026-10-22")).toBe("2026-10-23");
    expect(nextOccurrence("2026-10-10", "daily", "2026-10-22")).toBe("2026-10-23");
    expect(nextOccurrence("2026-10-22", "weekdays", "2026-10-23")).toBe("2026-10-26");
  });
});

describe("validation", () => {
  it("rejects impossible dates", () => {
    expect(isValidYmd("2026-10-22")).toBe(true);
    expect(isValidYmd("2026-02-30")).toBe(false);
    expect(isValidYmd("2026-13-01")).toBe(false);
    expect(isValidYmd("10/22/2026")).toBe(false);
  });

  it("checks IANA time zones", () => {
    expect(isValidTimeZone("America/Chicago")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone(undefined)).toBe(false);
  });
});

describe("time zones", () => {
  it("localYmd reports the date in the given zone", () => {
    const lateNightChicago = Date.UTC(2026, 9, 23, 3, 0); // 10pm Oct 22 in Chicago
    expect(localYmd(lateNightChicago, "America/Chicago")).toBe("2026-10-22");
    expect(localYmd(lateNightChicago, "Europe/London")).toBe("2026-10-23");
  });

  it("zonedTimeToUtc handles both sides of a DST change", () => {
    // Chicago: CDT (UTC-5) until Nov 1 2026, then CST (UTC-6)
    expect(zonedTimeToUtc("2026-10-31", "09:00", "America/Chicago")).toBe(Date.UTC(2026, 9, 31, 14, 0));
    expect(zonedTimeToUtc("2026-11-02", "09:00", "America/Chicago")).toBe(Date.UTC(2026, 10, 2, 15, 0));
  });

  it("zonedTimeToUtc works for zones ahead of UTC", () => {
    expect(zonedTimeToUtc("2026-10-22", "09:00", "Asia/Tokyo")).toBe(Date.UTC(2026, 9, 22, 0, 0));
  });
});
