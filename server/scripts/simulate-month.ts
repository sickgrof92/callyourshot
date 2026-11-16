// Simulates a month of busy game days against a fake Odds API and prints
// how many credits the scheduler spends each day. No real API calls.
//   npm run simulate
import { getBudgetStatus } from '../src/budget.ts';
import { tick } from '../src/scheduler.ts';
import { sportsDay } from '../src/time.ts';
import { et, FakeOddsApi, testConfig, testDb, type FakeGame } from '../test/helpers.ts';

const cfg = testConfig();
const db = testDb();
const games: FakeGame[] = [];
let n = 0;
for (let d = 1; d <= 30; d++) {
  const add = (sport: string, hours: number[], day = d) => {
    for (const h of hours) {
      games.push({ id: `g${n++}`, sport, start: et(2026, 11, day, Math.floor(h), (h % 1) * 60), home: `H${n}`, away: `A${n}` });
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
const perDay = new Map<string, number>();
for (let t = start; t <= end; t += 5 * 60_000) {
  api.clock = () => t;
  const before = api.used;
  await tick(db, cfg, api, t);
  const key = sportsDay(t, cfg.timeZone, cfg.dayStartHour).key;
  perDay.set(key, (perDay.get(key) ?? 0) + api.used - before);
}
for (const [day, spent] of perDay) {
  const b = getBudgetStatus(db, cfg, sportsDay(Date.parse(day + 'T17:00:00Z'), cfg.timeZone, cfg.dayStartHour).start + 3600_000);
  console.log(`${day}  spent ${String(spent).padStart(4)}  allowance ${b.allowanceToday}`);
}
console.log(`\nTotal spent ${api.used} of ${cfg.monthlyCredits}; ${api.remaining} left (reserve ${cfg.monthlyCredits * cfg.reserveFraction}).`);
