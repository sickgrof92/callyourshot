import { createAdSession, grantAdReward } from '../src/ads.ts';
import { loadConfig, type Config } from '../src/config.ts';
import { openDb, type DB } from '../src/db.ts';
import type { ApiResult, EventSummary, OddsApi, OddsEvent, ScoreEvent } from '../src/oddsApi.ts';
import { zonedToEpoch } from '../src/time.ts';

export function testConfig(over: Partial<Config> = {}): Config {
  return { ...loadConfig(), dbPath: ':memory:', adminToken: 'admin-secret', monthlyCredits: 20000, claimsKey: 'test-claims-key', ...over };
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

/** Watch (in stub form) the ad that every pick requires, returning its session id. */
export function pickAd(db: DB, cfg: Config, userId: string, now: number): string {
  const s = createAdSession(db, cfg, userId, 'pick', now);
  if (!s.ok) throw new Error(s.reason);
  const g = grantAdReward(db, cfg, s.sessionId, `test:${s.sessionId}`, now);
  if (!g.ok) throw new Error(g.reason);
  return s.sessionId;
}

let signUps = 0;
/** Sign up a new player through stub Apple sign-in, with a unique email and phone. */
export async function signUpPlayer(
  app: { inject: (o: object) => Promise<{ statusCode: number; json(): any }> },
  name: string,
  where: { country: 'US' | 'CA'; region: string } = { country: 'US', region: 'NY' },
): Promise<string> {
  const n = ++signUps;
  const res = await app.inject({
    method: 'POST',
    url: '/auth/signin',
    payload: {
      provider: 'apple',
      idToken: `stub-device-${name}-${n}`,
      profile: { displayName: name, email: `${name}${n}@example.com`, phone: `+1555${String(1000000 + n).slice(-7)}`, ...where, acceptedTerms: true },
    },
  });
  if (res.statusCode !== 200) throw new Error(`sign up failed: ${JSON.stringify(res.json())}`);
  return res.json().token as string;
}

/** A contest that runs for years, for tests that only care about picks and grading. */
export const TEST_CONTEST = 'test-contest';

/** Create a player in TEST_CONTEST holding `points`. */
export function seedPlayer(db: DB, userId: string, points: number, at: number): void {
  db.prepare('INSERT INTO users (id, display_name, token_hash, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING').run(userId, userId, `h-${userId}`, at);
  db.prepare(
    `INSERT INTO competitions (id, name, kind, prize, max_entries, starts_at, ends_at, created_at)
     VALUES (?, 'Test', 'monthly', 'Test prize', 1000, 0, 4102444800000, 0) ON CONFLICT DO NOTHING`,
  ).run(TEST_CONTEST);
  db.prepare('INSERT INTO competition_entries (competition_id, user_id, joined_at, balance) VALUES (?, ?, ?, ?)').run(TEST_CONTEST, userId, at, points);
}
