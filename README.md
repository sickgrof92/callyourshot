# Call Your Shot

A free sports pick'em app. Everything happens inside a contest: players join free daily, weekly and monthly contests, start each one at 0 points, watch a rewarded video for points, watch one short ad to confirm each pick on a real game, and climb that contest's board. The top player wins the contest's prize, which is set before the contest starts.

Open to residents of the US and Canada, excluding Quebec. Going live? See [LAUNCH.md](LAUNCH.md).

```
app/      Expo (React Native) app for iPhone and Android
server/   Node API: cached lines, contests, picks, points, claims, push, admin page, Odds API scheduler
```

## Ground rules (what keeps this a free contest)

These are enforced in code, not just policy:

- **Nobody can pay for points or buy an edge.** There is no in-app purchase, and the points ledger only accepts `ad_reward` and pick entries; the database rejects any other kind (`server/src/db.ts`).
- **Points can't be cashed out or transferred.** No such endpoint exists, and a test fails if a route with a name like purchase, transfer, gift, withdraw or redeem ever appears (`server/test/api.test.ts`).
- **Prizes are fixed and announced in advance.** A contest can only be created before it starts, and its prize, cap and dates lock once it starts (`server/src/competitions.ts`). Prizes have no link to ad revenue.
- **Ad rewards are a flat 10 points**, granted by the server only, after the ad network's signed callback for that player, ad unit and session (`server/src/ads.ts`). The app is never trusted to award points. Points belong to one contest. A player can only watch for points in a contest when they're out there (below 10 points with no picks in play), at most 5 times a day per contest, including the first 10.
- **Every pick needs its own ad.** The app plays it, then the player confirms the pick. The server refuses a pick without a fresh, unused pick ad (`server/src/ads.ts`).
- **Forfeit:** after a game starts and before it's graded, a player can watch an ad to give up a pick as a loss (no refund). This only gets them back to 0 sooner.
- User-facing text says "picks", "lines" and "points", and avoids "bet", "wager" and "odds".

## How it works

**Lines.** Only the server calls The Odds API. It caches moneyline, spread and total lines from one book per game (DraftKings first, then FanDuel, BetMGM, Caesars) so everyone sees the same numbers. Clients read `/lines` from our cache.

**Picks** lock at each game's scheduled `commence_time`, which is a clock check with no API call. A pick records the line it was made at. If the line changed since the player saw it, the server refuses and returns the new line to confirm. One pick per game per type (winner, spread, total).

**Grading.** When a game with pending picks should be over, the scheduler fetches that sport's scores and settles picks: win returns points per the line's price (e.g. 40 points at -110 returns 76), push returns the stake, loss keeps it. Games with no final score after 3 days (postponed or cancelled) are refunded.

**Contests.** Every player starts each contest at 0 with their own 5 refills a day, and can join as many contests as they like. A pick belongs to one contest and must be on a game that starts before the contest ends. A player's score is their points in that contest, counting points in play on ungraded picks.

**Tiebreakers**, in order: fewest refills used, then best win % (forfeits count as losses, pushes don't count), then most winning picks. Players still tied all win the full prize.

**Winners.** After a contest ends and its picks are graded, the admin taps **Pick winner**. Each winner sees **Claim your prize** in the app and enters their legal name, mailing address and date of birth (plus a tax ID for US prizes worth $600 or more, and a math skill-testing question in Canada). The server checks the age of majority for their state or province and stores the details encrypted, apart from the profile (`server/src/claims.ts`). Only the admin page shows them.

**Accounts.** Players sign in with Apple or Google and give a display name, email, phone, and state or province, and agree to the rules. Each email and phone can only be on one account (Gmail dots and +tags count as the same address). Phone verification by text isn't on yet; the `phone_verified_at` column is ready for it.

**Browsing contests.** Contests is the home screen. Players filter by sport, start time, length, size (max players) and prize type, and sort by starting soonest, most players or ending soonest. The server filters, sorts and pages the list (`GET /competitions`, 20 at a time), so it stays quick with many contests. Picking a sport also shows contests open to every sport. Filters are remembered on the phone.

**Menu.** The ☰ button on every tab opens: Contests, My profile & stats, My picks, Notification settings, How to play & FAQ, Rules, Privacy policy, Contact us and Sign out.

**Profiles.** Tapping a name on a board shows that player's record (W-L-T, forfeits as losses and pushes as ties), win %, longest win streak, reloads and contests won. Never their email, phone or location.

**Notifications** (Expo push), all on by default and each switchable from the bell on every tab or straight from the notification: a contest you joined is starting, a game you picked is starting, your pick won or lost, and a new contest you haven't joined has opened. The app asks for permission after a player's first pick, not at launch.

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

## Running contests (admin page)

Open `https://<your-server>/admin` on your phone or computer and sign in with `ADMIN_TOKEN`. From there you can:

- **Create one contest:** tap Daily, Weekly or Monthly to fill in the next open dates, then set the name, prize, prize value, prize type (gift card or physical), sport (all sports, or one sport only) and max entries and times. A one-sport contest only takes picks on that sport.
- **Schedule a run:** "7-day contests, one starting each day" or "30-day contests, one every Monday" fills in a batch (up to 60 at once), each named after its start day.
- **Edit or delete** a contest until it starts. Once it starts it's locked.
- **Copy** a contest to the next day or week.
- **Standings** with the tiebreak columns, and **Pick winner** once a contest has ended and its picks are graded.
- **Messages:** what players send from Contact us in the app menu, with their email and phone so you can reply. Tap Mark done when handled.
- **Winners:** each claim shows as Waiting on winner, Needs review, Verified, Paid, Not eligible or Rejected, with the winner's details. Tap Mark verified, then Mark paid after you send the prize.

The page also shows Odds API credits left. Too many wrong passwords lock the admin page for a while.

## Deploying the server

**Render (free, for testing):** `render.yaml` is a Blueprint for the free plan. [TESTING.md](TESTING.md) walks through deploying it and running the app on a phone with Expo Go. The free plan sleeps after 15 idle minutes, so `.github/workflows/keep-awake.yml` pings `/health` every 10 minutes once the `RENDER_URL` repository variable is set. The free plan also has no disk, so data resets on each restart or deploy.

**Anywhere else:** `server/Dockerfile` runs the API with SQLite stored at `/data`; mount a persistent volume there and run a single instance, since the scheduler and database live in one process. Set the env vars from `.env.example`.

## Not in v1

- Phone verification by text (structured for it, not turned on).
- In-app account deletion (needed for the App Store when sign-in is live; see LAUNCH.md).
- AppLovin MAX (AdMob is wired up; MAX would follow the same session + callback pattern).
