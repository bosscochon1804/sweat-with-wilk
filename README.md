# Sweat With Wilk — standalone app

**Sweat your ticket, play by play.**

This folder is a portable, standalone copy of the **Sweat With Wilk** live bet tracker.
It runs on plain Node.js with **zero external packages to install** — no `npm install`
of dependencies is needed (the only file it requires beyond Node itself is this folder).

What it does:

- **Accounts** — sign up / sign in / sign out, salted-hash passwords, 8 one-time
  recovery codes issued at signup, password reset by recovery code. Your tickets,
  board, bankroll, and alerts are private to your account.
- **Tickets** — add by screenshot (the image is stored with the ticket; OCR in the
  browser is best-effort prefill and you always review/edit the legs before saving)
  or by typing them in. Legs are grouped by game with live score/clock, period
  scoring, play-by-play (Plays / Stats / Scoring tabs), win probability when ESPN
  publishes it, and player-prop progress against the line.
- **Auto-settle** — when games go final, legs grade themselves (moneyline, spread,
  totals, and resolvable props; anything the feed can't prove stays "pending,"
  never guessed). Tickets close won/lost, boosted payouts are honored, and your
  Bankroll (record, win rate, streak, profit by day) updates.
- **Scores** — your games first, then any league.
- **Board** — the daily Top 30-style board, dated, stamped "Verified on Hard Rock
  Bet" per play; past days stay archived by date.
- **Community** — post tickets, talk picks and props, react (Respect / Tail it /
  Hot take), comment, and a Predictions leaderboard ranked only on real graded
  results. It starts empty — no fake members, ever.
- **Alerts** — an in-app inbox with a badge: game starts, leg flips, props
  crossing, leg finals, and ticket settlements, with per-type preferences and
  quiet hours. **Lock-screen push notifications included** — when a user turns
  push on (Account → Alerts), the same alerts also go to their phone's lock
  screen via Web Push. Requires VAPID keys in the host env (see .env.example);
  on iPhone the app must be added to the home screen first.

## Run it locally

You need Node.js 22 or newer.

```bash
node server.js
```

Then open http://localhost:3000

Optional settings (environment variables):

| Variable     | Default         | What it does                                   |
| ------------ | --------------- | ---------------------------------------------- |
| `PORT`       | `3000`          | Port to listen on (hosts usually set this).    |
| `DB_PATH`    | `./data/app.db` | Where the SQLite database file lives.          |
| `PUSH_TOKEN` | *(empty)*       | Secret for the morning push endpoints (below). |

## FREE DEPLOY KIT — put it on the internet for $0 (Render + GitHub)

Follow these steps exactly. You'll make two free accounts (GitHub and Render)
using your own email. Nothing here costs money.

### Part 1 — Put this folder on GitHub

1. Go to **github.com** and tap **Sign up**. Use your email, make a password,
   pick a username. Finish the signup and confirm the email GitHub sends you.
2. Once you're signed in, tap the **+** near the top right → **New repository**.
3. Name it `sweat-with-wilk`. Leave everything else as-is. Tap **Create repository**.
4. On the new repo page, tap the link **uploading an existing file**.
5. Drag in **everything inside this `sweat-with-wilk-app` folder** — `server.js`,
   `package.json`, `.env.example`, the whole `public` folder, and this README.
   (The `data` folder can go too; it's fine either way.)
6. Tap **Commit changes**.

### Part 2 — Put it live on Render

1. Go to **render.com** and tap **Get Started for Free** → sign up with
   **GitHub** (this connects the two accounts so Render can see your repo).
2. In the Render dashboard, tap **New** → **Web Service**.
3. Pick the **sweat-with-wilk** repository you just made.
4. Fill in the settings exactly:
   - **Name:** `sweat-with-wilk` (this becomes part of your web address)
   - **Runtime:** Node
   - **Build Command:** leave it as `npm install` (there are no dependencies,
     so this is quick and harmless) — or clear it; both work.
   - **Start Command:** `node server.js`
   - **Instance Type:** Free
5. Before creating, open **Advanced → Add Environment Variable** and add:
   - Key: `PUSH_TOKEN` — Value: a long random secret you make up
     (example shape: `swk-9f3kq7z2m8x4-long-and-random`). Write it down —
     the morning jobs need the exact same value.
6. Tap **Create Web Service**. Render builds and starts the app. When it says
   **Live**, your app is on the internet at an address like
   `https://sweat-with-wilk.onrender.com`.
7. Open that address on your phone. In the browser menu choose
   **Add to Home Screen** — you get the Sweat With Wilk icon and it opens
   full-screen like a store app. No App Store listing is involved.

### ⚠️ Honest persistence note — read this before you rely on it

Render's **free** tier does not keep local files forever:

- The free service **sleeps** after about 15 minutes of no visitors. The next
  visitor waits ~30–60 seconds for it to wake up. That's normal on free.
- The **database and uploaded ticket screenshots live in a local file**
  (`data/app.db`). On the free tier, that file can be **wiped when the service
  redeploys or restarts** — which means accounts, tickets, and history can reset.
- **What that means for launch:** fine for getting the doors open, testing, and
  the first wave of your list. It is NOT a forever home for people's records.
- **The safer pattern when you're ready:** either (a) put `DB_PATH` on a
  persistent disk (Render sells disks — that's the one small paid upgrade that
  matters), or (b) move the database to a free hosted database. The app reads
  `DB_PATH` from the environment, so no code change is needed for option (a):
  mount the disk, set `DB_PATH` to a path on it (for example
  `/var/data/app.db`), redeploy once.

## Morning jobs — push endpoints

The daily board and the 9 AM ticket are pushed in by the owner's morning jobs.
Both endpoints require the header `x-push-token` to exactly match the
`PUSH_TOKEN` environment variable, or they refuse.

- **POST `/api/push/board`** — body:
  `{ "date": "2026-10-05", "plays": [ { "league": "NFL", "play": "Chiefs -3.5", "market": "Spread", "odds": -110, "tier": "actionable", "edgeNote": "…", "sportsbook": "Hard Rock Bet", "verified": true, "verifiedAt": "…" } ] }`
  Idempotent: the same date + league + play is never inserted twice.
- **POST `/api/push/ticket`** — body:
  `{ "externalRef": "morning-2026-10-05", "username": "<owner username>", "title": "Morning ticket", "stake": 10, "sportsbook": "Hard Rock Bet", "legs": [ { "league": "NFL", "gameLabel": "Chiefs @ Bills", "selection": "Chiefs", "market": "Moneyline", "line": "", "odds": -150, "startsAt": "" } ] }`
  Idempotent by `externalRef` per owner — pushing the same ref twice returns the
  existing ticket instead of duplicating it.

## What is NOT included

- **No push notifications** — alerts are in-app inbox + badge only.
- **No App Store / Google Play listing** — this is a web app; use
  "Add to Home Screen" for the app experience.
- **No real-money betting** — Sweat With Wilk tracks tickets; it never places
  bets or touches money.
- OCR of ticket screenshots is **best-effort** (runs in the visitor's browser via
  a CDN library) and always lands in a review form — it never saves a ticket
  on its own.
