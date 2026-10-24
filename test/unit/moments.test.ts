import { describe, expect, it } from "vitest";
import { addNote, chooseMemory, type Memory } from "../../src/core/memories";
import {
  CAPTION_MAX,
  addMoment,
  canShow,
  deleteMoment,
  describeMoment,
  hasMedia,
  makeMoment,
  parseLink,
  titleFromFileName,
  VIDEO_MAX_BYTES,
  VIDEO_MAX_SECONDS,
  videoProblem,
} from "../../src/core/moments";
import { completeQuest } from "../../src/core/rules";
import type { Moment, State } from "../../src/core/types";
import { emptyState, quest, sequence } from "../helpers/fixtures";

const TODAY = "2026-10-26";
const when = (day: string, now = 1) => ({ id: `m-${day}-${String(now)}`, today: day, now });
const make = (input: Parameters<typeof makeMoment>[0], day = "2026-10-23", now = 1): Moment => {
  const r = makeMoment(input, when(day, now));
  if ("error" in r) throw new Error(r.error);
  return r.moment;
};

describe("parseLink", () => {
  it("names well-known music and movie sites", () => {
    expect(parseLink("https://open.spotify.com/track/abc")?.source).toBe("Spotify");
    expect(parseLink("https://youtu.be/xyz")?.source).toBe("YouTube");
    expect(parseLink("https://music.youtube.com/watch?v=1")?.source).toBe("YouTube Music");
    expect(parseLink("https://artist.bandcamp.com/track/song")?.source).toBe("Bandcamp");
    expect(parseLink("https://www.imdb.com/title/tt0111161/")?.source).toBe("IMDb");
    expect(parseLink("https://letterboxd.com/film/heat/")?.source).toBe("Letterboxd");
  });

  it("falls back to the host name", () => {
    expect(parseLink("https://www.example.org/x")?.source).toBe("example.org");
  });

  it("accepts only http and https links", () => {
    expect(parseLink("javascript:alert(1)")).toBeNull();
    expect(parseLink("data:text/html,hi")).toBeNull();
    expect(parseLink("not a link")).toBeNull();
  });
});

describe("makeMoment", () => {
  it("makes a photo moment with just a caption", () => {
    expect(make({ kind: "photo", caption: "  Bash chasing gulls  " })).toMatchObject({
      kind: "photo",
      caption: "Bash chasing gulls",
      day: "2026-10-23",
    });
  });

  it("makes a song from a link and names the source", () => {
    expect(make({ kind: "song", title: "Harvest Moon", link: "https://open.spotify.com/track/1" })).toMatchObject({
      title: "Harvest Moon",
      source: "Spotify",
      url: "https://open.spotify.com/track/1",
    });
  });

  it("needs a title or link for songs and movies", () => {
    expect(makeMoment({ kind: "song", caption: "good" }, when(TODAY))).toEqual({
      error: "Add the song's name, a link, or a music file.",
    });
    expect(makeMoment({ kind: "movie" }, when(TODAY))).toEqual({ error: "Add the title or a link." });
  });

  it("rejects links that aren't web links", () => {
    expect(makeMoment({ kind: "song", title: "x", link: "javascript:alert(1)" }, when(TODAY))).toHaveProperty("error");
  });

  it("caps the caption", () => {
    expect(make({ kind: "photo", caption: "a".repeat(CAPTION_MAX + 20) }).caption).toHaveLength(CAPTION_MAX);
  });
});

describe("adding and deleting", () => {
  it("keeps moments newest first and deletes by id", () => {
    const S = emptyState();
    const a = make({ kind: "photo", caption: "a" }, "2026-10-22", 1);
    const b = make({ kind: "movie", title: "Heat" }, "2026-10-23", 2);
    addMoment(S, a);
    addMoment(S, b);
    expect(S.moments?.map((m) => m.id)).toEqual([b.id, a.id]);
    deleteMoment(S, a.id);
    expect(S.moments?.map((m) => m.id)).toEqual([b.id]);
  });
});

describe("describeMoment", () => {
  it("words each kind", () => {
    expect(describeMoment(make({ kind: "photo", caption: "lake" })).headline).toBe("A photo from your day");
    expect(describeMoment(make({ kind: "song", title: "Harvest Moon" })).headline).toBe(
      "You were listening to Harvest Moon",
    );
    expect(describeMoment(make({ kind: "movie", title: "Heat" })).headline).toBe("You watched Heat");
  });
});

describe("moments in memory drops", () => {
  function withHistory(): State {
    const S = emptyState();
    completeQuest(S, quest(1, { name: "Strum", g: "Art" }), { today: "2026-10-23", now: 5 });
    addNote(S, "You've come back before.", { today: "2026-10-23", now: 6 });
    addMoment(S, make({ kind: "photo", caption: "Bash at the lake", area: "Bash" }, "2026-10-22", 7));
    addMoment(S, make({ kind: "song", title: "Harvest Moon", area: "Art" }, "2026-10-23", 8));
    return S;
  }
  const ctx = { today: TODAY, lowDay: false, tier: "small" as const };
  const pickKinds = (
    S: State,
    c: typeof ctx & { lowDay?: boolean; area?: string; available?: (m: Memory) => boolean },
  ) => [0, 0.25, 0.5, 0.75, 0.99].map((r) => chooseMemory(S, c, sequence(r))?.kind);

  it("on a hard day, a moment wins over notes", () => {
    expect(new Set(pickKinds(withHistory(), { ...ctx, lowDay: true }))).toEqual(new Set(["moment"]));
  });

  it("after a quest, brings back a moment from the same area", () => {
    const m = chooseMemory(withHistory(), { ...ctx, area: "Art" }, sequence(0));
    expect(m?.moment?.title).toBe("Harvest Moon");
  });

  it("skips moments whose photo isn't on this device", () => {
    const m = chooseMemory(
      withHistory(),
      { ...ctx, lowDay: true, available: (x) => x.moment?.kind !== "photo" },
      sequence(0),
    );
    expect(m?.moment?.kind).toBe("song");
  });

  it("never brings back a moment from today", () => {
    const S = emptyState();
    addMoment(S, make({ kind: "photo", caption: "now" }, TODAY));
    expect(chooseMemory(S, { ...ctx, lowDay: true })).toBeNull();
  });
});

describe("audio moments", () => {
  it("a song can be just its music file", () => {
    expect(make({ kind: "song", audio: true, title: "Harvest Moon" })).toMatchObject({ kind: "song", audio: true });
    expect(makeMoment({ kind: "song", audio: true }, when(TODAY))).not.toHaveProperty("error");
  });

  it("a recording needs something recorded", () => {
    expect(makeMoment({ kind: "recording", caption: "riff" }, when(TODAY))).toEqual({
      error: "Record something first.",
    });
    expect(make({ kind: "recording", audio: true, caption: "riff" })).toMatchObject({ kind: "recording", audio: true });
  });

  it("only songs and recordings carry audio", () => {
    expect(make({ kind: "movie", title: "Heat", audio: true }).audio).toBeUndefined();
  });

  it("words recordings", () => {
    expect(describeMoment(make({ kind: "recording", audio: true })).headline).toBe("Something you recorded");
    expect(describeMoment(make({ kind: "recording", audio: true, title: "the new riff" })).headline).toBe(
      "You recorded the new riff",
    );
  });

  it("knows which moments carry files and which can show without them", () => {
    const photo = make({ kind: "photo" });
    const rec = make({ kind: "recording", audio: true });
    const songFile = make({ kind: "song", title: "x", audio: true });
    const songTitle = make({ kind: "song", title: "x" });
    expect([photo, rec, songFile, songTitle].map(hasMedia)).toEqual([true, true, true, false]);
    const nothingHere = () => false;
    expect([photo, rec, songFile, songTitle].map((m) => canShow(m, nothingHere))).toEqual([false, false, true, true]);
  });

  it("guesses a title from a music file name", () => {
    expect(titleFromFileName("01 - Harvest_Moon.mp3")).toBe("Harvest Moon");
    expect(titleFromFileName("Neil Young - Old Man.flac")).toBe("Neil Young - Old Man");
    expect(titleFromFileName("track.m4a")).toBe("track");
  });
});

describe("video moments", () => {
  it("needs its file, and says so", () => {
    expect(makeMoment({ kind: "video", caption: "Bash in the waves" }, when(TODAY))).toEqual({
      error: "Choose a video first.",
    });
    expect(make({ kind: "video", video: true, caption: "Bash in the waves" })).toMatchObject({
      kind: "video",
      caption: "Bash in the waves",
    });
  });

  it("is worded as a video, carries a file and needs it to show", () => {
    const v = make({ kind: "video", video: true });
    expect(describeMoment(v).headline).toBe("A video from your day");
    expect(hasMedia(v)).toBe(true);
    expect(canShow(v, () => false)).toBe(false);
    expect(canShow(v, () => true)).toBe(true);
  });

  it("holds clips up to a minute and 95 MB", () => {
    const MB = 1024 * 1024;
    expect(videoProblem(20 * MB, 45)).toBeNull();
    expect(videoProblem(20 * MB, VIDEO_MAX_SECONDS)).toBeNull();
    expect(videoProblem(20 * MB, 60.3)).toBeNull(); // phones round a "1:00" clip up a little
    expect(videoProblem(20 * MB, 95)).toBe(
      "That video is 95 seconds. Moments hold up to a minute: trim it first, or pick a shorter one.",
    );
    expect(videoProblem(VIDEO_MAX_BYTES + 1, 10)).toBe("That video is over 95 MB. Try a shorter clip.");
    expect(videoProblem(MB, Number.NaN)).toBe("Couldn't play that video. Try another one.");
  });
});
