/**
 * "What's new": a short note shown once to people who already use the app, after a change they'd
 * notice. To announce something, add an entry at the top with a new id; nothing else changes.
 */

export interface News {
  /** Unique and never reused, so each note shows once. */
  id: string;
  title: string;
  body: string;
}

/** Newest first. Only the newest is ever shown. */
export const NEWS: readonly News[] = [
  {
    id: "2026-11-trail-loot",
    title: "New: trail loot and titles.",
    body: "Every drop is now a small, real reward you can give yourself, and your level has a title. See yours just above.",
  },
];

/** The note to show, given the id of the last one seen: the newest, unless it was already seen. */
export function newsToShow(seen: string | null, news: readonly News[] = NEWS): News | null {
  const latest = news.at(0);
  return latest && latest.id !== seen ? latest : null;
}
