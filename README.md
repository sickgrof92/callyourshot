# Call Your Shot

A free sports pick'em app. Players watch a rewarded video for points, watch one short ad to confirm each pick on a real game, and climb weekly and monthly leaderboards. The top player in each period wins a fixed prize that is announced before the period starts.

```
app/      Expo (React Native) app for iPhone and Android
server/   Node API: cached lines, picks, points, leaderboards, Odds API scheduler
```

## Ground rules (what keeps this a free contest)

These are enforced in code, not just policy:

- **Nobody can pay for points or buy an edge.** There is no in-app purchase, and the points ledger only accepts `ad_reward` and pick entries; the database rejects any other kind (`server/src/db.ts`).
- **Points can't be cashed out or transferred.** No such endpoint exists, and a test fails if a route with a name like purchase, transfer, gift, withdraw or redeem ever appears (`server/test/api.test.ts`).
- **Prizes are fixed and announced in advance.** A prize can only be created before its period starts and can't be edited after (`server/src/leaderboard.ts`). Prizes have no link to ad revenue.
- **Ad rewards are a flat 10 points**, granted by the server only (after the ad network's signed callback). A player can only watch for points when they're out (below 10 points with no picks in play), at most 5 times a day, including a new player's first 10.
- **Every pick needs its own ad.** The app plays it, then the player confirms the pick. The server refuses a pick without a fresh, unused pick ad (`server/src/ads.ts`).
- **Forfeit:** after a game starts and before it's graded, a player can watch an ad to give up a pick as a loss (no refund). This only gets them back to 0 sooner.
- User-facing text says "picks", "lines" and "points", and avoids "bet", "wager" and "odds".

## How it works

**Lines.** Only the server calls The Odds API. It caches moneyline, spread and total lines from one book per game (DraftKings first, then FanDuel, BetMGM, Caesars) so everyone sees the same numbers. Clients read `/lines` from our cache.

**Picks** lock at each game's scheduled `commence_time`, which is a clock check with no API call. A pick records the line it was made at. If the line changed since the player saw it, the server refuses and returns the new line to confirm. One pick per game per type (winner, spread, total).

**Grading.** When a game with pending picks should be over, the scheduler fetches that sport's scores and settles picks: win returns points per the line's price (e.g. 40 points at -110 returns 76), push returns the stake, loss keeps it. Games with no final score after 3 days (postponed or cancelled) are refunded.

**Leaderboards.** A player's score for a week (Monday to Monday, Eastern) or month is the points they gained in it: video rewards plus pick results for games that started in it. Ties go to whoever got there first.

## Credit budget (The Odds API)

The plan size is one setting, `ODDS_API_MONTHLY_CREDITS`. It defaults to **500 (free tier)**. When you upgrade to the $30 plan, set it to `20000` and restart; nothing else changes. Also set `ODDS_API_RESET_DAY` to the day of the month your plan renews.

| Call | Cost | When |
| --- | --- | --- |
| Events list | free | every 6h per sport, to know who plays today |
| Lines (3 markets, US region) | 3 | only for sports with games still to start today |
| Scores (with `daysFrom`) | 2 | only for sports with ungraded picks on games that should be over |

The scheduler (`server/src/scheduler.ts`) ticks every minute and spends only when something is due:

- **Only sports with games today** (5 AM to 5 AM Eastern) get line refreshes.
- **Rare early, frequent late:** every 4 hours when the next game is more than 3 hours away, every 30 minutes inside the 3 hours before a game.
- **Tracks credits:** every response's `x-requests-remaining` / `x-requests-last` headers are logged in `api_calls`.
- **Daily allowance:** each day gets (remaining − 10% reserve) ÷ days left in the billing period: about 15/day on the free tier, about 600/day on the $30 plan. Unused credits roll forward.
- **Slows down near the limit:** if the rest of today's plan would overspend the allowance, or the month is running ahead of pace, every interval is stretched proportionally (up to 8x).
- **Reserve:** inside the last 10%, line refreshes stop and score checks drop to every 2 hours so picks still get graded. At 1% everything stops.

**Small plans (lean mode).** When a day's allowance is under 60 credits (the free tier gives about 15), the scheduler switches to a lean schedule instead:

- It picks which sports get a line refresh today, as many as fit after setting aside credits for grading (usually 2 to 3 on the free tier). Sports take turns: whichever has gone longest without a refresh goes first, so every sport gets fresh lines every day or two.
- Each chosen sport refreshes once, about 2 hours before its first game.
- Scores are checked at most once per sport every 12 hours, after that sport's pending games should be over (with an hour of slack for overtime), so one call grades a whole night.
- Sports skipped today keep the lines from their last refresh (every refresh also brings lines for that sport's upcoming games on later days).

Simulated busy month with a player picking every game (`npm run simulate` in `server/`):

| Plan | Credits/day | Line refreshes/day | Spent in 30 days | Picks graded |
| --- | --- | --- | --- | --- |
| Free, 500 | ~14 | 2–3 | 438 (62 left) | all |
| $30, 20,000 | ~180–310 | ~60–85 | ~7,400 | all |

`ODDS_API_MONTHLY_CREDITS=20000 npm run simulate` shows the paid-plan numbers.

## Running locally

Server (Node 22.13+):

```bash
cd server
npm install
cp .env.example .env     # add ODDS_API_KEY and ADMIN_TOKEN (never commit .env)
set -a; . ./.env; set +a
npm run dev              # http://localhost:8080
npm test
```

Without `ODDS_API_KEY` the API runs but no lines load.

App:

```bash
cd app
npm install
cp .env.example .env.local   # set EXPO_PUBLIC_API_URL to your server
npx expo start
```

With the server on `AD_PROVIDER=stub` (the default), the Earn tab plays a fake 5-second video so you can test in Expo Go. Real ads need a development build (`npx expo run:ios` / `run:android` or EAS Build).

## Turning on real ads (AdMob)

1. Create an AdMob account, an app for iOS and Android, and a **Rewarded** ad unit for each.
2. In `app/app.json`, replace the `react-native-google-mobile-ads` app IDs (currently Google's test IDs).
3. Set `EXPO_PUBLIC_ADMOB_REWARDED_IOS` and `EXPO_PUBLIC_ADMOB_REWARDED_ANDROID` for release builds. Debug builds always use Google's test unit.
4. In AdMob, turn on server-side verification for each rewarded unit with callback URL `https://<your-server>/ads/admob/ssv`.
5. Set `AD_PROVIDER=admob` on the server.

The app passes a one-time session id as the SSV custom data; the server verifies Google's signature and grants 10 points once per session.

## Running prizes (admin)

All admin calls need `Authorization: Bearer $ADMIN_TOKEN`.

```bash
# Announce next week's prize (must be before the week starts)
curl -X POST $API/admin/prizes -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"periodKey":"weekly:2026-11-23","title":"$50 gift card","description":"Top score for the week of Nov 23"}'

# After the period ends and its picks are graded, record the winner
curl -X POST $API/admin/prizes/weekly:2026-11-23/finalize -H "authorization: Bearer $ADMIN_TOKEN"

# Credit usage and recent Odds API calls
curl $API/admin/budget -H "authorization: Bearer $ADMIN_TOKEN"
```

Period keys are `weekly:<Monday date>` or `monthly:<YYYY-MM>`.

## Deploying the server

**Render (free, for testing):** `render.yaml` is a Blueprint for the free plan. [TESTING.md](TESTING.md) walks through deploying it and running the app on a phone with Expo Go. The free plan sleeps after 15 idle minutes, so `.github/workflows/keep-awake.yml` pings `/health` every 10 minutes once the `RENDER_URL` repository variable is set. The free plan also has no disk, so data resets on each restart or deploy.

**Anywhere else:** `server/Dockerfile` runs the API with SQLite stored at `/data`; mount a persistent volume there and run a single instance, since the scheduler and database live in one process. Set the env vars from `.env.example`.

## Not in v1

- Real accounts (sign in with Apple/Google). Players are device-based guest accounts today; you'll want verified contact details before handing out prizes.
- Official contest rules and eligibility (age, location) reviewed by a lawyer.
- AppLovin MAX (AdMob is wired up; MAX would follow the same session + callback pattern).
- Push notifications for graded picks.
