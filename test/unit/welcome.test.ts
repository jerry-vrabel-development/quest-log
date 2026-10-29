import { describe, expect, it } from "vitest";
import { splitState, mergeState } from "../../src/core/privacy";
import { freshState } from "../../src/core/state";
import { applyWelcome, cleanAnswers, greeting, shouldWelcome, skipWelcome, starters } from "../../src/core/welcome";

const TODAY = "2026-10-29"; // a Thursday
const NOW = 1_800_000_000_000;

describe("the welcome flow", () => {
  it("offers itself only on a brand-new start", () => {
    const S = freshState(TODAY);
    expect(shouldWelcome(S)).toBe(true);
    skipWelcome(S, NOW);
    expect(shouldWelcome(S)).toBe(false);
    const used = freshState(TODAY);
    used.log.push({ t: "quest", at: 1, day: TODAY, id: 1, name: "x", g: "", xp: 5 });
    expect(shouldWelcome(used)).toBe(false); // someone already using the app never gets it by surprise
  });

  it("swaps the generic starters for ones that fit, and keeps the tour", () => {
    const S = freshState(TODAY);
    applyWelcome(S, { name: " Rhiannon ", areas: ["Pet", "Art", "Gardening"], helps: ["start"] }, TODAY, NOW);
    expect(S.profile).toEqual({ name: "Rhiannon", areas: ["Pet", "Art", "Gardening"], helps: ["start"], at: NOW });
    const names = S.quests.map((q) => q.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "Check off this quest",
        "Log how you feel right now",
        "Add one small quest of your own",
        "Walk or play with your pet",
        "Make something for 10 minutes",
        "One small step for Gardening",
        "Roll the dice once when you're stuck",
      ]),
    );
    expect(names).not.toContain("Apply to one job"); // generic starter swapped out
    expect(names).not.toContain("Clear one surface");
    const pet = S.quests.find((q) => q.name === "Walk or play with your pet");
    expect(pet).toMatchObject({ g: "Pet", repeat: "daily", due: TODAY, tiny: "Grab the leash or a toy" });
    expect(new Set(S.quests.map((q) => q.id)).size).toBe(S.quests.length); // ids stay unique
  });

  it("never removes a starter you've already touched", () => {
    const S = freshState(TODAY);
    const apply = S.quests.find((q) => q.name === "Apply to one job");
    if (apply) apply.count = 2;
    applyWelcome(S, { areas: ["Health"], helps: [] }, TODAY, NOW);
    expect(S.quests.map((q) => q.name)).toContain("Apply to one job");
  });

  it("with no areas chosen, keeps the starters and only adds helpers", () => {
    const S = freshState(TODAY);
    const before = S.quests.length;
    applyWelcome(S, { areas: [], helps: ["remember", "progress"] }, TODAY, NOW);
    expect(S.quests.length).toBe(before + 2);
    expect(S.quests.find((q) => q.name === "Look at your Journey on Sunday")?.due).toBe("2026-11-01");
  });

  it("doesn't add a quest twice", () => {
    const S = freshState(TODAY);
    applyWelcome(S, { areas: ["Health"], helps: [] }, TODAY, NOW);
    expect(S.quests.filter((q) => q.name === "Drink a glass of water")).toHaveLength(1);
  });

  it("tidies answers", () => {
    expect(cleanAnswers({ name: "   ", areas: ["  Pet ", "Pet", ""], helps: ["start", "bogus"] })).toEqual({
      areas: ["Pet"],
      helps: ["start"],
    });
    expect(starters(["Work"], []).map((q) => q.name)).toEqual(["Do one small work task"]);
  });

  it("greets by time of day, and only with a name", () => {
    expect(greeting("Rhiannon", 8)).toBe("Good morning, Rhiannon.");
    expect(greeting("Rhiannon", 14)).toBe("Good afternoon, Rhiannon.");
    expect(greeting("Rhiannon", 20)).toBe("Good evening, Rhiannon.");
    expect(greeting("Rhiannon", 2)).toBe("Hey, Rhiannon.");
    expect(greeting(undefined, 8)).toBe("");
  });

  it("keeps the profile sealed in sync, and gets it back on another device", () => {
    const S = freshState(TODAY);
    applyWelcome(S, { name: "Rhiannon", areas: ["Pet"], helps: [] }, TODAY, NOW);
    const { shared, secret } = splitState(S);
    expect(JSON.stringify(shared)).not.toContain("Rhiannon");
    expect(shared.profile).toBeUndefined();
    expect(secret.profile?.name).toBe("Rhiannon");
    expect(mergeState(shared, secret).profile?.name).toBe("Rhiannon");
  });
});
