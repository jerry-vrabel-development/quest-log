import { describe, expect, it } from "vitest";
import { describeQuickAdd, parseQuickAdd, understoodSomething, type QuickAdd } from "../../src/core/quickadd";

const TODAY = "2026-10-29"; // a Thursday

describe("smart quick-add", () => {
  it.each<[string, QuickAdd]>([
    // dates
    ["Call dentist tomorrow", { name: "Call dentist", due: "2026-10-30" }],
    ["Pay rent today", { name: "Pay rent", due: TODAY }],
    ["Text Mike tonight", { name: "Text Mike", due: TODAY }],
    ["Book vet next week", { name: "Book vet", due: "2026-11-05" }],
    ["Renew license in 3 days", { name: "Renew license", due: "2026-11-01" }],
    ["Laundry on saturday", { name: "Laundry", due: "2026-10-31" }],
    ["Send invoice friday", { name: "Send invoice", due: "2026-10-30" }],
    ["Team call thursday", { name: "Team call", due: "2026-11-05" }], // a weekday name means the next one, not today
    ["Haircut next mon", { name: "Haircut", due: "2026-11-02" }],
    // times
    ["Call dentist tomorrow 10am", { name: "Call dentist", due: "2026-10-30", time: "10:00" }],
    ["Call dentist tomorrow at 10:30 am", { name: "Call dentist", due: "2026-10-30", time: "10:30" }],
    ["Lunch with Ann at noon", { name: "Lunch with Ann", due: TODAY, time: "12:00" }],
    ["Call mom at 3", { name: "Call mom", due: TODAY, time: "15:00" }], // bare 1-7 means afternoon
    ["Stand-up at 9", { name: "Stand-up", due: TODAY, time: "09:00" }],
    ["Pick up meds friday 5:45pm", { name: "Pick up meds", due: "2026-10-30", time: "17:45" }],
    ["Midnight snack 12am", { name: "Midnight snack", due: TODAY, time: "00:00" }],
    ["Take pills 20:15", { name: "Take pills", due: TODAY, time: "20:15" }],
    // repeats
    ["Walk Bash every day at 8", { name: "Walk Bash", due: TODAY, time: "08:00", repeat: "daily" }],
    ["Drink water daily", { name: "Drink water", due: TODAY, repeat: "daily" }],
    ["Apply to one job every weekday", { name: "Apply to one job", due: TODAY, repeat: "weekdays" }],
    ["Take out recycling every tuesday", { name: "Take out recycling", due: "2026-11-03", repeat: "weekly" }],
    ["Guitar practice every thursday 7pm", { name: "Guitar practice", due: TODAY, time: "19:00", repeat: "weekly" }],
    ["Review budget monthly", { name: "Review budget", due: TODAY, repeat: "monthly" }],
    ["Clean fridge weekly", { name: "Clean fridge", due: TODAY, repeat: "weekly" }],
  ])("%s", (input, expected) => {
    expect(parseQuickAdd(input, TODAY)).toEqual(expected);
  });

  it("leaves words alone when it isn't sure, and never invents a schedule", () => {
    for (const s of ["Read chapter 10", "Fix the 3 broken links", "Write the Monday-ish plan", "Buy 2 eggs"])
      expect(understoodSomething(parseQuickAdd(s, TODAY))).toBe(false);
    expect(parseQuickAdd("Read chapter 10", TODAY)).toEqual({ name: "Read chapter 10" });
    expect(parseQuickAdd("at 25", TODAY).time).toBeUndefined(); // not a real time
  });

  it("keeps the rest of the name intact and tidy", () => {
    expect(parseQuickAdd("  email Rhiannon about the demo   tomorrow  ", TODAY).name).toBe(
      "Email Rhiannon about the demo",
    );
    expect(parseQuickAdd("submit Exygy application by tomorrow", TODAY).name).toBe("Submit Exygy application");
  });

  it("describes what it understood in words", () => {
    const d = (s: string) => describeQuickAdd(parseQuickAdd(s, TODAY), TODAY);
    expect(d("Call dentist tomorrow 10am")).toBe("Tomorrow · 10:00 AM");
    expect(d("Call mom at 3")).toBe("Today · 3:00 PM");
    expect(d("Send invoice monday")).toBe("Mon, Nov 2");
    expect(d("Walk Bash every day at 8")).toBe("Every day · 8:00 AM");
    expect(d("Take out recycling every tuesday")).toBe("Every Tuesday, from Tue, Nov 3");
    expect(d("Apply every weekday 9am")).toBe("Weekdays · 9:00 AM");
    expect(d("Lunch at noon")).toBe("Today · 12:00 PM");
  });
});
