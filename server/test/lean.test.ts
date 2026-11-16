import { describe, expect, it } from 'vitest';
import { tx } from '../src/db.ts';
import { placePick } from '../src/picks.ts';
import { postLedger } from '../src/points.ts';
import { tick } from '../src/scheduler.ts';
import { sportsDay } from '../src/time.ts';
import { et, FakeOddsApi, testConfig, testDb, type FakeGame } from './helpers.ts';

const MIN = 60_000;

/** Every day: NBA, NHL and college basketball; college football Saturdays; NFL Sundays. */
function month(): FakeGame[] {
  const games: FakeGame[] = [];
  let n = 0;
  for (let d = 1; d <= 30; d++) {
    const dow = new Date(Date.UTC(2026, 10, d)).getUTCDay();
    const add = (sport: string, hours: number[]) => {
      for (const h of hours) {
        games.push({ id: `g${n++}`, sport, start: et(2026, 11, d, Math.floor(h), (h % 1) * 60), home: `H${n}`, away: `A${n}`, homeScore: 30, awayScore: 20 });
      }
    };
    add('basketball_nba', [19, 19.5, 20, 22]);
    add('basketball_ncaab', [12, 14, 16, 18, 19, 20, 21]);
    add('icehockey_nhl', [13, 19, 19, 22]);
    if (dow === 6) add('americanfootball_ncaaf', [12, 15.5, 19.5, 22.5]);
    if (dow === 0) add('americanfootball_nfl', [13, 16.5, 20.33]);
  }
  return games;
}

describe('free tier (500 credits a month)', () => {
  it('stays inside 500 credits, refreshes lines every day, and grades every pick', async () => {
    const cfg = testConfig({ monthlyCredits: 500 });
    const db = testDb();
    const games = month();
    const start = Date.UTC(2026, 10, 1, 0, 1);
    const end = Date.UTC(2026, 10, 30, 23, 55);
    const api = new FakeOddsApi(games, () => start, 500);
    db.prepare("INSERT INTO users (id, display_name, token_hash, created_at) VALUES ('u', 'u', 'h', 0)").run();
    tx(db, () => postLedger(db, { userId: 'u', kind: 'ad_reward', amount: 100000, scoreDelta: 0, ref: null, at: start }));

    let placed = 0;
    for (let t = start; t <= end; t += 5 * MIN) {
      api.clock = () => t;
      // Each afternoon, pick every open game that has lines and starts today.
      const day = sportsDay(t, cfg.timeZone, cfg.dayStartHour);
      if (t - day.start >= 10 * 60 * MIN && t - day.start < 10 * 60 * MIN + 5 * MIN) {
        for (const g of games.filter((x) => x.start > t && x.start < day.end)) {
          if (placePick(db, cfg, 'u', { eventId: g.id, market: 'moneyline', selection: 'home', points: 10 }, t).ok) placed++;
        }
      }
      await tick(db, cfg, api, t);
    }
    // Let the last games finish and grade.
    for (let t = end; t <= end + 2 * 24 * 60 * MIN; t += 15 * MIN) {
      api.clock = () => t;
      await tick(db, cfg, api, t);
    }

    const spent = api.used;
    expect(spent).toBeLessThanOrEqual(500 - 5); // never past the 1% hard floor
    expect(api.remaining).toBeGreaterThanOrEqual(5);

    // Lines refreshed for at least one sport on every day of the month.
    const days = new Set(api.calls.filter((c) => c.endpoint === 'odds').map((c) => sportsDay(c.at, cfg.timeZone, cfg.dayStartHour).key));
    for (let d = 1; d <= 29; d++) expect(days.has(`2026-11-${String(d).padStart(2, '0')}`)).toBe(true);

    // Every pick settled with a real result (not refunded for lack of scores).
    expect(placed).toBeGreaterThan(100);
    const rows = db.prepare('SELECT status, COUNT(*) AS n FROM picks GROUP BY status').all() as { status: string; n: number }[];
    expect(rows).toEqual([{ status: 'won', n: placed }]);
  }, 120_000);
});
