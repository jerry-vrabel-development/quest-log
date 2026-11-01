import { describe, expect, it } from "vitest";
import { NEWS, newsToShow, type News } from "../../src/core/news";

const a: News = { id: "a", title: "A.", body: "First." };
const b: News = { id: "b", title: "B.", body: "Second." };

describe("newsToShow", () => {
  it("shows the newest note to someone who hasn't seen it", () => {
    expect(newsToShow(null, [b, a])).toBe(b);
    expect(newsToShow("a", [b, a])).toBe(b);
  });

  it("shows nothing once the newest was seen, or when there's no news", () => {
    expect(newsToShow("b", [b, a])).toBeNull();
    expect(newsToShow(null, [])).toBeNull();
  });

  it("every note has a unique id and says something", () => {
    expect(new Set(NEWS.map((n) => n.id)).size).toBe(NEWS.length);
    for (const n of NEWS) expect(n.title.trim() && n.body.trim()).toBeTruthy();
  });
});
