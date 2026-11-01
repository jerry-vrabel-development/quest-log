/**
 * Shows the newest "What's new" note once, after the opening screen. Someone opening the app for
 * the first time skips it: nothing changed for them, and the welcome is theirs.
 */
import { newsToShow, type News } from "../core/news";
import { $ } from "./dom";
import { whenBegun } from "./session";
import { prefs } from "./store";

const SEEN_KEY = "news-seen";

function show(item: News): void {
  $("#newsTitle").textContent = item.title;
  $("#newsBody").textContent = item.body;
  const banner = $("#newsBanner");
  banner.hidden = false;
  $("#newsOk").onclick = () => {
    prefs.set(SEEN_KEY, item.id);
    banner.hidden = true;
  };
}

export function initNews(firstRun: boolean): void {
  const item = newsToShow(prefs.get(SEEN_KEY));
  if (!item) return;
  if (firstRun) {
    prefs.set(SEEN_KEY, item.id);
    return;
  }
  whenBegun(() => {
    show(item);
  });
}
