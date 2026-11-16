import { loadConfig, type Config } from '../src/config.ts';
import { openDb, type DB } from '../src/db.ts';
import type { ApiResult, EventSummary, OddsApi, OddsEvent, ScoreEvent } from '../src/oddsApi.ts';
import { zonedToEpoch } from '../src/time.ts';

export function testConfig(over: Partial<Config> = {}): Config {
  return { ...loadConfig(), dbPath: ':memory:', adminToken: 'admin-secret', ...over };
}

export function testDb(): DB {
  return openDb(':memory:');
}

/** Wall-clock time in New York. */
export const et = (y: number, m: number, d: number, h: number, min = 0) =>
  zonedToEpoch(y, m, d, h, 'America/New_York') + min * 60_000;

export interface FakeGame {
  id: string;
  sport: string;
  start: number;
  home: string;
  away: string;
  homeScore?: number;
  awayScore?: number;
}

/** In-memory stand-in for The Odds API that charges credits like the real one. */
export class FakeOddsApi implements OddsApi {
  remaining: number;
  used = 0;
  calls: { endpoint: string; sport: string; at: number; cost: number }[] = [];
  constructor(
    public games: FakeGame[],
    public clock: () => number,
    startingCredits = 20000,
    public gameLengthMs = 3 * 3600_000,
  ) {
    this.remaining = startingCredits;
  }

  private charge<T>(endpoint: string, sport: string, cost: number, data: T): ApiResult<T> {
    this.remaining -= cost;
    this.used += cost;
    this.calls.push({ endpoint, sport, at: this.clock(), cost });
    return { data, usage: { remaining: this.remaining, used: this.used, last: cost } };
  }

  private summary(g: FakeGame): EventSummary {
    return { id: g.id, sport_key: g.sport, commence_time: new Date(g.start).toISOString(), home_team: g.home, away_team: g.away };
  }

  async getEvents(sport: string) {
    const now = this.clock();
    const list = this.games
      .filter((g) => g.sport === sport && g.start + this.gameLengthMs > now && g.start < now + 8 * 86400_000)
      .map((g) => this.summary(g));
    return this.charge('events', sport, 0, list);
  }

  async getOdds(sport: string) {
    const now = this.clock();
    const list: OddsEvent[] = this.games
      .filter((g) => g.sport === sport && g.start + this.gameLengthMs > now && g.start < now + 8 * 86400_000)
      .map((g) => ({
        ...this.summary(g),
        bookmakers: [
          {
            key: 'draftkings',
            title: 'DraftKings',
            last_update: new Date(now).toISOString(),
            markets: [
              { key: 'h2h', outcomes: [{ name: g.home, price: -150 }, { name: g.away, price: 130 }] },
              { key: 'spreads', outcomes: [{ name: g.home, price: -110, point: -3.5 }, { name: g.away, price: -110, point: 3.5 }] },
              { key: 'totals', outcomes: [{ name: 'Over', price: -110, point: 44.5 }, { name: 'Under', price: -110, point: 44.5 }] },
            ],
          },
        ],
      }));
    return this.charge('odds', sport, 3, list);
  }

  async getScores(sport: string, daysFrom: number) {
    const now = this.clock();
    const list: ScoreEvent[] = this.games
      .filter((g) => g.sport === sport && g.start <= now && g.start >= now - daysFrom * 86400_000)
      .map((g) => {
        const completed = g.start + this.gameLengthMs <= now && g.homeScore !== undefined;
        return {
          ...this.summary(g),
          completed,
          scores: completed
            ? [
                { name: g.home, score: String(g.homeScore) },
                { name: g.away, score: String(g.awayScore) },
              ]
            : null,
        };
      });
    return this.charge('scores', sport, 2, list);
  }
}
