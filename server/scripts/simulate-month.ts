// Simulates a month of busy game days (with a player making picks every day)
// against a fake Odds API and prints the credits spent each day. No real API calls.
//   npm run simulate                                  # uses ODDS_API_MONTHLY_CREDITS (default 500)
//   ODDS_API_MONTHLY_CREDITS=20000 npm run simulate
import { getBudgetStatus } from '../src/budget.ts';
import { loadConfig } from '../src/config.ts';
import { tx } from '../src/db.ts';
import { placePick } from '../src/picks.ts';
import { postLedger } from '../src/points.ts';
import { tick } from '../src/scheduler.ts';
import { sportsDay } from '../src/time.ts';
import { et, FakeOddsApi, pickAd, testConfig, testDb, type FakeGame } from '../test/helpers.ts';

const cfg = testConfig({ monthlyCredits: loadConfig().monthlyCredits });
const db = testDb();
const games: FakeGame[] = [];
let n = 0;
for (let d = 1; d <= 30; d++) {
  const add = (sport: string, hours: number[], day = d) => {
    for (const h of hours) {
      games.push({ id: `g${n++}`, sport, start: et(2026, 11, day, Math.floor(h), (h % 1) * 60), home: `H${n}`, away: `A${n}`, homeScore: 30, awayScore: 20 });
    }
  };
  add('basketball_nba', [19, 19.5, 20, 22]);
  add('basketball_ncaab', [12, 14, 16, 18, 19, 20, 21]);
  add('icehockey_nhl', [13, 19, 19, 22]);
  if (d % 7 === 0) add('americanfootball_ncaaf', [12, 15.5, 19.5, 22.5]); // Saturdays
  if (d % 7 === 1) add('americanfootball_nfl', [13, 16.5, 20.33]); // Sundays
}
const start = Date.UTC(2026, 10, 1, 0, 1);
const end = Date.UTC(2026, 10, 30, 23, 55);
const api = new FakeOddsApi(games, () => start, cfg.monthlyCredits);
db.prepare("INSERT INTO users (id, display_name, token_hash, created_at) VALUES ('u', 'u', 'h', 0)").run();
tx(db, () => postLedger(db, { userId: 'u', kind: 'ad_reward', amount: 1_000_000, scoreDelta: 0, ref: null, at: start }));
const perDay = new Map<string, number>();
for (let t = start; t <= end; t += 5 * 60_000) {
  api.clock = () => t;
  const sd = sportsDay(t, cfg.timeZone, cfg.dayStartHour);
  if (t - sd.start >= 10 * 3600_000 && t - sd.start < 10 * 3600_000 + 5 * 60_000) {
    for (const g of games.filter((x) => x.start > t && x.start < sd.end)) {
      placePick(db, cfg, 'u', { eventId: g.id, market: 'moneyline', selection: 'home', points: 10, adSessionId: pickAd(db, cfg, 'u', t) }, t);
    }
  }
  const before = api.used;
  await tick(db, cfg, api, t);
  const key = sportsDay(t, cfg.timeZone, cfg.dayStartHour).key;
  perDay.set(key, (perDay.get(key) ?? 0) + api.used - before);
}
for (const [day, spent] of perDay) {
  const b = getBudgetStatus(db, cfg, sportsDay(Date.parse(day + 'T17:00:00Z'), cfg.timeZone, cfg.dayStartHour).start + 3600_000);
  const calls = api.calls.filter((c) => sportsDay(c.at, cfg.timeZone, cfg.dayStartHour).key === day);
  const lines = calls.filter((c) => c.endpoint === 'odds').length;
  const scores = calls.filter((c) => c.endpoint === 'scores').length;
  console.log(`${day}  spent ${String(spent).padStart(4)}  allowance ${String(b.allowanceToday).padStart(4)}  line refreshes ${String(lines).padStart(3)}  score checks ${String(scores).padStart(3)}`);
}
const graded = db.prepare("SELECT status, COUNT(*) AS n FROM picks GROUP BY status").all();
console.log('\nPicks by status:', JSON.stringify(graded));
console.log(`Total spent ${api.used} of ${cfg.monthlyCredits}; ${api.remaining} left (reserve ${cfg.monthlyCredits * cfg.reserveFraction}).`);
