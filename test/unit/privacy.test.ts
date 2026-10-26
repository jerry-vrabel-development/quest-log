import { describe, expect, it } from "vitest";
import { addNote } from "../../src/core/memories";
import { addMoment } from "../../src/core/moments";
import { isPrivateBundle, mergeState, splitState } from "../../src/core/privacy";
import { completeQuest, recordMood } from "../../src/core/rules";
import type { State } from "../../src/core/types";
import { emptyState, quest } from "../helpers/fixtures";

const day = "2026-10-26";
function life(): State {
  const S = emptyState({ quests: [quest(1, { name: "Walk Bash", g: "Bash" })] });
  recordMood(S, 3, "slept on the beach", { today: day, now: 1 }, { anxiety: 4, sleep: "6 hours" });
  completeQuest(S, S.quests[0] ?? quest(1), { today: day, now: 2 });
  addNote(S, "You've come back before.", { today: day, now: 3 });
  addMoment(S, { id: "m1", at: 4, day, kind: "photo", caption: "Bash at the lake" });
  S.memSeen = ["note:3"];
  return S;
}

describe("what sync shares with the server", () => {
  it("keeps check-ins, notes, moments and their words out of the shared part", () => {
    const { shared } = splitState(life());
    const text = JSON.stringify(shared);
    for (const secret of ["slept on the beach", "6 hours", "You've come back", "Bash at the lake", "anxiety"])
      expect(text).not.toContain(secret);
    expect(shared.moods).toEqual([]);
    expect(shared.log.every((e) => e.t !== "mood")).toBe(true);
  });

  it("keeps what reminders and the Claude connector need", () => {
    const { shared } = splitState(life());
    expect(shared.quests.map((q) => q.name)).toEqual(["Walk Bash"]);
    expect(shared.log.some((e) => e.t === "quest" && e.name === "Walk Bash")).toBe(true);
    expect(shared.xp).toBe(life().xp);
  });

  it("puts everything back together exactly", () => {
    const S = life();
    const { shared, secret } = splitState(S);
    expect(mergeState(shared, JSON.parse(JSON.stringify(secret)) as typeof secret)).toEqual(S);
  });

  it("keeps a check-in Claude logged on the server since the last sync", () => {
    const S = life();
    const { shared, secret } = splitState(S);
    recordMood(shared, 6, "via Claude", { today: day, now: 10, via: "claude" }); // the server's copy
    const merged = mergeState(shared, secret);
    expect(merged.moods.map((m) => m.v)).toEqual([3, 6]);
    expect(merged.log.filter((e) => e.t === "mood").map((e) => e.at)).toEqual([10, 1]);
    // and the next sync seals it too
    expect(JSON.stringify(splitState(merged).shared)).not.toContain("via Claude");
  });

  it("leaves an older, unsealed save as it is", () => {
    const S = life();
    expect(mergeState(S, null)).toEqual(S);
  });

  it("only trusts a sealed part with the right shape", () => {
    expect(isPrivateBundle(splitState(life()).secret)).toBe(true);
    expect(isPrivateBundle({ v: 1, moods: [] })).toBe(false);
    expect(isPrivateBundle(null)).toBe(false);
  });
});
