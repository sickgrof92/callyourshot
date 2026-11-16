import { describe, expect, it } from 'vitest';
import { getBudgetStatus } from '../src/budget.ts';
import type { DB } from '../src/db.ts';
import { placePick } from '../src/picks.ts';
import { estimateOddsCalls, FAR_INTERVAL, NEAR_INTERVAL, NEAR_WINDOW, nextOddsDue, tick } from '../src/scheduler.ts';
import { sportsDay } from '../src/time.ts';
import { et, FakeOddsApi, pickAd, seedPlayer, TEST_CONTEST, testConfig, testDb, type FakeGame } from './helpers.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;

/** A busy college-football Saturday (Nov 21 2026) plus Sunday NFL. */
function saturdaySlate(day = { y: 2026, m: 11, d: 21 }): FakeGame[] {
  const games: FakeGame[] = [];
  let n = 0;
  const add = (sport: string, hours: number[], date = day) => {
    for (const h of hours) {
      const hh = Math.floor(h);
      games.push({
        id: `${sport}-${date.d}-${n++}`,
        sport,
        start: et(date.y, date.m, date.d, hh, Math.round((h - hh) * 60)),
        home: `Home${n}`,
        away: `Away${n}`,
        homeScore: 24,
        awayScore: 20,
      });
    }
  };
  add('americanfootball_ncaaf', [12, 12, 12, 15.5, 15.5, 19.5, 19.5, 22.5]);
  add('basketball_ncaab', [12, 14, 16, 18, 19, 20, 21, 22]);
  add('basketball_nba', [19, 19.5, 20, 22.5]);
  add('icehockey_nhl', [13, 19, 19, 22]);
  add('americanfootball_nfl', [13, 13, 16.42, 20.33], { ...day, d: day.d + 1 });
  return games;
}

async function runTicks(db: DB, cfg: ReturnType<typeof testConfig>, api: FakeOddsApi, from: number, to: number, step: number, onTick?: (t: number) => void) {
  for (let t = from; t <= to; t += step) {
    api.clock = () => t;
    onTick?.(t);
    await tick(db, cfg, api, t);
  }
}

function giveUserPoints(db: DB, id: string, amount: number, at: number) {
  seedPlayer(db, id, amount, at);
}

describe('refresh timing', () => {
  it('refreshes rarely when the next game is far away and often within 3 hours', () => {
    const game = et(2026, 11, 21, 19);
    const morning = et(2026, 11, 21, 6);
    expect(nextOddsDue(morning, game, 1)).toBe(morning + FAR_INTERVAL);
    const latemorning = et(2026, 11, 21, 14);
    // Far phase never sleeps past the opening of the 3-hour window.
    expect(nextOddsDue(latemorning, game, 1)).toBe(game - NEAR_WINDOW);
    const close = et(2026, 11, 21, 17);
    expect(nextOddsDue(close, game, 1)).toBe(close + NEAR_INTERVAL);
    expect(nextOddsDue(close, game, 2)).toBe(close + 2 * NEAR_INTERVAL);
    expect(nextOddsDue(null, game, 1)).toBe(-Infinity);
  });

  it('estimates a single evening game at a handful of refreshes', () => {
    const game = et(2026, 11, 21, 19);
    // 5am, 9am, 1pm, 4pm, then every 30 min to 6:30pm -> 9
    expect(estimateOddsCalls([game], null, et(2026, 11, 21, 5))).toBe(9);
  });
});

describe('scheduler over a busy Saturday', () => {
  it('stays inside the daily allowance, skips sports with no games, and grades picks', async () => {
    const cfg = testConfig();
    const db = testDb();
    const games = saturdaySlate();
    const start = et(2026, 11, 21, 4);
    const day = sportsDay(et(2026, 11, 21, 12), cfg.timeZone, cfg.dayStartHour);
    // Credits chosen so today's allowance is ~600 (the normal figure for a 30-day month).
    const daysLeft = Math.ceil((Date.UTC(2026, 11, 1) - day.start) / 86400_000);
    const api = new FakeOddsApi(games, () => start, 600 * daysLeft + 2000);

    giveUserPoints(db, 'u1', 1000, start);
    let placed = 0;
    await runTicks(db, cfg, api, start, et(2026, 11, 22, 5), MIN, (t) => {
      if (t === et(2026, 11, 21, 11)) {
        for (const g of games.filter((x) => x.start < et(2026, 11, 22, 0) && x.sport !== 'americanfootball_nfl')) {
          const r = placePick(db, cfg, 'u1', { competitionId: TEST_CONTEST, eventId: g.id, market: 'spread', selection: 'home', points: 10, adSessionId: pickAd(db, cfg, 'u1', t) }, t);
          if (r.ok) placed++;
        }
      }
    });

    const budget = getBudgetStatus(db, cfg, et(2026, 11, 21, 23));
    const inDay = api.calls.filter((c) => c.at >= day.start && c.at < day.end);
    const spent = inDay.reduce((s, c) => s + c.cost, 0);
    expect(budget.allowanceToday).toBeGreaterThanOrEqual(590);
    expect(spent).toBeLessThanOrEqual(budget.allowanceToday);

    // NFL plays Sunday, so Saturday spends nothing on NFL lines.
    expect(inDay.filter((c) => c.sport === 'americanfootball_nfl' && c.endpoint === 'odds')).toHaveLength(0);

    // Rare early, frequent near game time.
    const ncaaf = inDay.filter((c) => c.sport === 'americanfootball_ncaaf' && c.endpoint === 'odds');
    expect(ncaaf.filter((c) => c.at < et(2026, 11, 21, 9)).length).toBeLessThanOrEqual(1);
    expect(ncaaf.filter((c) => c.at >= et(2026, 11, 21, 9) && c.at < et(2026, 11, 21, 12)).length).toBeGreaterThanOrEqual(4);
    // Nothing after the last start of the day.
    expect(ncaaf.filter((c) => c.at >= et(2026, 11, 21, 22, 30))).toHaveLength(0);

    // Every pick got graded (home -3.5 with a 24-20 final -> won).
    expect(placed).toBeGreaterThan(10);
    const pending = db.prepare("SELECT COUNT(*) AS n FROM picks WHERE status = 'pending'").get() as { n: number };
    expect(pending.n).toBe(0);
    const won = db.prepare("SELECT COUNT(*) AS n FROM picks WHERE status = 'won'").get() as { n: number };
    expect(won.n).toBe(placed);
  });

  it('slows down when the allowance is tight', async () => {
    const cfg = testConfig();
    const db = testDb();
    const games = saturdaySlate();
    const start = et(2026, 11, 21, 4);
    const day = sportsDay(et(2026, 11, 21, 12), cfg.timeZone, cfg.dayStartHour);
    const daysLeft = Math.ceil((Date.UTC(2026, 11, 1) - day.start) / 86400_000);
    const api = new FakeOddsApi(games, () => start, 120 * daysLeft + 2000);
    await runTicks(db, cfg, api, start, et(2026, 11, 22, 5), MIN);
    const inDay = api.calls.filter((c) => c.at >= day.start && c.at < day.end);
    const spent = inDay.reduce((s, c) => s + c.cost, 0);
    expect(spent).toBeLessThanOrEqual(120);
    // Still refreshes every sport with games at least a few times.
    for (const sport of ['americanfootball_ncaaf', 'basketball_ncaab', 'basketball_nba', 'icehockey_nhl']) {
      expect(inDay.filter((c) => c.sport === sport && c.endpoint === 'odds').length).toBeGreaterThanOrEqual(2);
    }
  });

  it('stops line refreshes inside the reserve but keeps grading, and halts at the floor', async () => {
    const cfg = testConfig();
    const db = testDb();
    const games = saturdaySlate();
    const start = et(2026, 11, 21, 10);
    const api = new FakeOddsApi(games, () => start, 20000);
    api.clock = () => start;
    await tick(db, cfg, api, start); // loads events + first lines
    giveUserPoints(db, 'u1', 100, start);
    const g = games.find((x) => x.sport === 'basketball_nba')!;
    expect(placePick(db, cfg, 'u1', { competitionId: TEST_CONTEST, eventId: g.id, market: 'total', selection: 'under', points: 10, adSessionId: pickAd(db, cfg, 'u1', start) }, start).ok).toBe(true);

    api.remaining = 1900; // under the 2000 reserve
    const before = api.calls.length;
    await runTicks(db, cfg, api, start + MIN, et(2026, 11, 22, 4), MIN);
    const after = api.calls.slice(before);
    // We only learn the new balance from the next response, so at most one more line call goes out.
    expect(after.filter((c) => c.endpoint === 'odds').length).toBeLessThanOrEqual(1);
    const scores = after.filter((c) => c.endpoint === 'scores');
    expect(scores.length).toBeGreaterThan(0);
    for (let i = 1; i < scores.length; i++) expect(scores[i].at - scores[i - 1].at).toBeGreaterThanOrEqual(2 * HOUR);
    const pick = db.prepare('SELECT status FROM picks').get() as { status: string };
    expect(pick.status).toBe('won');

    api.remaining = 150; // below the 1% hard floor
    const n = api.calls.length;
    await runTicks(db, cfg, api, et(2026, 11, 22, 4), et(2026, 11, 22, 23), 5 * MIN);
    // Free event listings may still go out until a response reveals the new balance; nothing paid does.
    expect(api.calls.slice(n).filter((c) => c.cost > 0)).toHaveLength(0);
  });
});

describe('scheduler over a whole month', () => {
  it('keeps the reserve intact through 30 busy days', async () => {
    const cfg = testConfig();
    const db = testDb();
    const games: FakeGame[] = [];
    for (let d = 1; d <= 30; d++) {
      for (const g of saturdaySlate({ y: 2026, m: 11, d })) if (new Date(g.start).getUTCMonth() === 10) games.push(g);
    }
    const start = Date.UTC(2026, 10, 1, 0, 1);
    const end = Date.UTC(2026, 10, 30, 23, 55);
    const api = new FakeOddsApi(games, () => start, 20000);
    await runTicks(db, cfg, api, start, end, 5 * MIN);
    const spent = api.calls.reduce((s, c) => s + c.cost, 0);
    expect(api.remaining).toBeGreaterThanOrEqual(2000);
    expect(spent).toBeLessThanOrEqual(18000);
    // and it actually uses the budget rather than starving
    expect(spent).toBeGreaterThan(9000);
  }, 120_000);
});
