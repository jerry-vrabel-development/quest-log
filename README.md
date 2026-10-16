# Quest Log (Cloudflare edition)

A gamified, ADHD-friendly quest tracker with scheduling, device sync, real push reminders that fire even when the app is closed, mood tracking, badges, and a **Claude connector** (remote MCP server with OAuth 2.1) so an AI assistant can add, schedule and complete quests from a conversation. It runs entirely on Cloudflare's free tier: Workers + static assets + D1 + KV + a cron trigger.

## How it works
- **`public/`** is the PWA: plain HTML/CSS/JS, no build step.
- **`src/worker.js`** serves the PWA and a small API:
  - `GET/PUT /api/state` syncs your quests (last write wins, with conflict protection)
  - `POST/DELETE /api/subscribe` registers a device for push
  - `GET /api/outbox` lets the service worker pick up notification text
  - `POST /api/test-push` sends a test notification
- **Cron (every 5 min)** finds due reminders in each user's time zone, queues them once, and sends an **empty Web Push** (VAPID-signed). The service worker wakes up, fetches the outbox and shows the notifications. Because the push has no payload, no encryption library is needed.
- **No login.** The app generates a private **sync code**. The server stores only its SHA-256 hash. Paste the code into a second device to link it. Treat it like a password.

## Claude connector (MCP)

`/mcp` is a remote MCP server (Streamable HTTP, stateless JSON-RPC) behind OAuth 2.1, implemented with [`@cloudflare/workers-oauth-provider`](https://github.com/cloudflare/workers-oauth-provider):

- **Discovery:** unauthenticated calls get `401` with a `resource_metadata` pointer (RFC 9728); authorization server metadata per RFC 8414.
- **Client registration:** Dynamic Client Registration (RFC 7591) and Client ID Metadata Documents.
- **Sign-in:** `/authorize` is a consent page where the user enters their Quest Log **sync code**; it's hashed and matched against D1, and the grant stores only that hash.
- **Tokens:** PKCE (S256), 1-hour access tokens, rotating refresh tokens with a 60-day idle lifetime. Tokens are stored hashed in KV.

| Tool | What it does |
|---|---|
| `list_quests` | Now / upcoming / all / done views, with ids |
| `add_quests` | Add up to 25 quests at once; `done: true` records something already finished |
| `complete_quest` | Completes by id; repeating quests roll forward |
| `update_quest` | Rename, reschedule, change the tiny step, etc. |
| `delete_quest` | Delete by id (marked destructive) |
| `log_mood` | 1–10 check-in with an optional note |
| `get_summary` | Level, streak, quests and mood per day over N days |

Gamification stays in the client: XP is added server-side, but the variable-ratio **loot roll and badge checks happen when the app next opens** (`state.rewards`), so the reward still lands where the user sees it.

### Connect it to Claude
Settings → Connectors → **Add custom connector** → URL `https://<your-worker-host>/mcp` → Connect → enter your sync code (app: Settings → Show sync code). Custom connectors need a paid Claude plan.

## Deploy (about 15 minutes)

You need Node 18+ and your Cloudflare account.

```bash
cd quest-log-server
npm install
npx wrangler login                 # opens the browser, sign in to Cloudflare

# 1. Database
npx wrangler d1 create quest-log   # copy the database_id it prints into wrangler.jsonc
npm run db:init                    # creates the tables

# 2. OAuth storage for the Claude connector
npx wrangler kv namespace create OAUTH_KV   # answer "no" if asked to add it; paste the id into wrangler.jsonc

# 3. Push keys
npm run vapid                      # prints a public key and a private key
#    -> paste the public key into wrangler.jsonc (vars.VAPID_PUBLIC_KEY)
npx wrangler secret put VAPID_PRIVATE_JWK   # paste the private key JSON when asked

# 4. Ship it
npm run deploy                     # prints your https://quest-log.<you>.workers.dev URL
```

Also set `VAPID_SUBJECT` in `wrangler.jsonc` to an email you check (push services use it to contact you if something goes wrong).

### Use your own domain (optional)
If forwardslash-development.com's DNS is on Cloudflare: Workers & Pages → quest-log → Settings → Domains & Routes → **Add custom domain** → `quests.forwardslash-development.com`.

## First run
1. Open the URL on your phone and install it (Android: menu → *Install app*; iPhone: Share → *Add to Home Screen*, then open it from the home screen; iOS 16.4+ needed for notifications).
2. ⚙ Settings → **Turn on sync**.
3. **Turn on** reminders and allow notifications. Push is set up automatically.
4. Tap **Send test notification**. It should arrive within seconds.
5. On your laptop: open the same URL → Settings → **Link with a code**, and paste the code from **Show sync code** on your phone.

## Local development
```bash
npm run db:init:local
echo "VAPID_PRIVATE_JWK='<private key json>'" > .dev.vars
npx wrangler dev --test-scheduled  # http://localhost:8787
curl "http://localhost:8787/__scheduled?cron=*/5+*+*+*+*"   # run the reminder cron by hand
```

## Cost
Free-tier limits are far above what this needs (a few hundred requests a day). If you ever outgrow them, Workers Paid starts at $5/month.

## Notes
- Reminders: no time set means 9:00 AM; "Remind me: No reminder" turns it off. Each occurrence fires once; reminders stop 6 hours after the due time.
- Repeating quests roll forward when completed; missed days don't pile up.
- The calendar (.ics) export and JSON backup still work, sync or not.
- Seed quests are in `seed()` and the loot table in `LOOT`, near the top of `public/app.js`.
