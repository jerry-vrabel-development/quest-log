// The reminder cron: every 5 minutes, queue due reminders once and wake each device with a push.
import { dueReminders } from "../public/js/core/reminders.js";
import { DEFAULT_TZ, enqueue, markSent, pruneSent, usersWithPush } from "./db.js";
import { pushUser } from "./push.js";

export async function runReminders(env, now = Date.now(), push = pushUser) {
  const users = await usersWithPush(env.DB);
  let queued = 0;
  for (const u of users) {
    let state;
    try {
      state = JSON.parse(u.state);
    } catch {
      continue;
    }
    let fresh = 0;
    for (const r of dueReminders(state, u.tz || DEFAULT_TZ, now)) {
      if (!(await markSent(env.DB, u.id, r.key, now))) continue; // already sent
      await enqueue(env.DB, u.id, { title: r.title, body: r.body, tag: r.key }, now);
      fresh++;
    }
    if (fresh) {
      queued += fresh;
      await push(env, u.id);
    }
  }
  await pruneSent(env.DB, now);
  return { users: users.length, queued };
}
