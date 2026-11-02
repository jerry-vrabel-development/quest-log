import { describe, expect, it } from "vitest";
import {
  COMPANIONS,
  LEGENDARY,
  PACKS,
  companionById,
  companionFor,
  foundFrom,
  handedBy,
  packSize,
  poolFor,
  timesFound,
  type CompanionId,
} from "../../src/core/party";
import { LOOT, queueReward, rollLoot } from "../../src/core/rules";
import type { LootItem } from "../../src/core/types";
import { emptyState, sequence } from "../helpers/fixtures";

const ids = COMPANIONS.map((c) => c.id);
const allItems = [...Object.values(PACKS).flatMap((p) => [...p.common, ...p.rare, ...p.epic]), ...LEGENDARY];

describe("the companions", () => {
  it("each has a name, an icon, a voice and a pack", () => {
    expect(ids).toHaveLength(10);
    for (const c of COMPANIONS) {
      expect(c.name).toMatch(/^The /);
      expect(c.icon.trim()).not.toBe("");
      expect(c.voice.length).toBeGreaterThan(10);
      expect(PACKS[c.id]).toBeDefined();
    }
  });

  it("each pack has at least 8 common, 5 rare and 3 epic, so drops stay fresh", () => {
    for (const id of ids) {
      expect(PACKS[id].common.length).toBeGreaterThanOrEqual(8);
      expect(PACKS[id].rare.length).toBeGreaterThanOrEqual(5);
      expect(PACKS[id].epic.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("no two items anywhere share a name, and every item means something", () => {
    expect(new Set(allItems.map(([n]) => n)).size).toBe(allItems.length);
    for (const [n, d] of allItems) {
      expect(n.trim()).not.toBe("");
      expect(d.trim().length).toBeGreaterThan(10);
    }
  });

  it("is written for anyone: nothing about one particular person or pet", () => {
    for (const [n, d] of allItems) expect(`${n} ${d}`).not.toMatch(/\bBash\b|recruit|Employee #|Dot-Com/i);
  });

  it("the general loot is the Guide's pack plus the shared legendaries", () => {
    expect(LOOT.common).toBe(PACKS.guide.common);
    expect(LOOT.legendary).toBe(LEGENDARY);
    expect(poolFor("bard", "legendary")).toBe(LEGENDARY);
  });
});

describe("companionFor", () => {
  it.each<[string | undefined, CompanionId]>([
    // the welcome flow's areas, any case
    ["Health", "healer"],
    ["work", "quartermaster"],
    ["Home", "hearthkeeper"],
    ["Pet", "ranger"],
    ["Art", "bard"],
    ["Money", "merchant"],
    ["Friends & family", "envoy"],
    ["Learning", "scholar"],
    ["Getting started", "guide"],
    // areas people write themselves
    ["Career", "quartermaster"],
    ["Programming", "artificer"],
    ["Next home", "hearthkeeper"],
    ["Strength", "healer"],
    ["Bash", "ranger"],
    ["Gym days", "healer"],
    ["Walk the dog", "ranger"],
    ["Guitar practice", "bard"],
    ["Side projects in code", "artificer"],
    ["Rent and bills", "merchant"],
    // nobody's → the Guide
    ["Gardening club", "healer"],
    ["Volunteering", "guide"],
    ["My quests", "guide"],
    ["", "guide"],
    [undefined, "guide"],
  ])("%s → %s", (area, id) => {
    expect(companionFor(area).id).toBe(id);
  });

  it("a word only matches whole: 'workout' is the Healer's, not the Quartermaster's", () => {
    expect(companionFor("Morning workout").id).toBe("healer");
  });
});

describe("loot from a companion", () => {
  /** Rarity rolls stay common (0.5); item picks come from the sequence after them. */
  const commons = (...picks: number[]) => sequence(...picks.flatMap((p) => [0.5, p]));

  it("comes from that companion's pack and says who handed it over", () => {
    const S = emptyState();
    const it = rollLoot(S, sequence(0.5, 0), 1, false, "healer");
    expect(it?.by).toBe("healer");
    expect(PACKS.healer.common.map(([n]) => n)).toContain(it?.n);
    expect(handedBy(it ?? {})).toBe("🌿 The Healer");
  });

  it("never repeats until you've seen the whole pack", () => {
    const S = emptyState();
    const size = PACKS.ranger.common.length;
    const rng = commons(...Array.from({ length: size }, () => 0)); // always ask for the first one left
    const names = Array.from({ length: size }, () => rollLoot(S, rng, 1, true, "ranger")?.n);
    expect(new Set(names).size).toBe(size);
    // the next one is allowed to come back
    const next = rollLoot(S, sequence(0.5, 0), 2, true, "ranger");
    expect(names).toContain(next?.n);
  });

  it("each companion's deck is separate", () => {
    const S = emptyState();
    rollLoot(S, sequence(0.5, 0), 1, true, "bard");
    const first = rollLoot(S, sequence(0.5, 0), 2, true, "merchant");
    expect(first?.n).toBe(PACKS.merchant.common[0][0]);
  });

  it("legendaries are shared: a second one is the other legendary, whoever hands it over", () => {
    const S = emptyState();
    const a = rollLoot(S, sequence(0.01, 0), 1, false, "scholar");
    const b = rollLoot(S, sequence(0.01, 0), 2, false, "artificer");
    expect(new Set([a?.n, b?.n]).size).toBe(2);
    expect(LEGENDARY.map(([n]) => n)).toEqual(expect.arrayContaining([a?.n, b?.n]));
  });

  it("items found before the Party still count toward 'found again', and don't break anything", () => {
    const old: LootItem = { rar: "common", n: "Squeaky Ball", d: "old", at: 0 };
    const S = emptyState({ inv: [old] });
    expect(handedBy(old)).toBeNull();
    expect(timesFound(S.inv, "Squeaky Ball")).toBe(1);
    expect(foundFrom(S.inv, "ranger")).toBe(0);
  });
});

describe("progress through a pack", () => {
  it("counts different items, not repeats or legendaries", () => {
    const at = 0;
    const inv: LootItem[] = [
      { rar: "common", n: "Bookmark", d: "", at, by: "scholar" },
      { rar: "common", n: "Bookmark", d: "", at, by: "scholar" },
      { rar: "rare", n: "Puzzle Box", d: "", at, by: "scholar" },
      { rar: "legendary", n: "North Star", d: "", at, by: "scholar" },
    ];
    expect(foundFrom(inv, "scholar")).toBe(2);
    expect(timesFound(inv, "Bookmark")).toBe(2);
    expect(packSize("scholar")).toBe(16);
    expect(packSize("artificer")).toBe(23);
  });

  it("companionById finds a companion, or nothing", () => {
    expect(companionById("envoy")?.name).toBe("The Envoy");
    expect(companionById("nobody")).toBeUndefined();
    expect(companionById(undefined)).toBeUndefined();
  });
});

describe("Claude's quests", () => {
  it("queue their area so the loot comes from the right companion", () => {
    const S = emptyState();
    queueReward(S, "Walk Bash", 10, 1, "Bash");
    queueReward(S, "Mood check-in", 5, 2);
    expect(S.rewards).toEqual([
      { name: "Walk Bash", xp: 10, at: 1, g: "Bash" },
      { name: "Mood check-in", xp: 5, at: 2 },
    ]);
  });
});
