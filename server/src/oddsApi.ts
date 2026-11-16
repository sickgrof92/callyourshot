// Thin client for The Odds API (v4). Only the server talks to it; clients read our cache.

export interface ApiUsage {
  /** Credits left in the billing period (x-requests-remaining). */
  remaining: number | null;
  /** Credits used in the billing period (x-requests-used). */
  used: number | null;
  /** Cost of this request (x-requests-last). */
  last: number | null;
}

export interface ApiResult<T> {
  data: T;
  usage: ApiUsage;
}

export interface Outcome {
  name: string;
  price: number;
  point?: number;
}

export interface Market {
  key: string; // h2h | spreads | totals
  outcomes: Outcome[];
}

export interface Bookmaker {
  key: string;
  title: string;
  last_update: string;
  markets: Market[];
}

export interface EventSummary {
  id: string;
  sport_key: string;
  commence_time: string;
  home_team: string;
  away_team: string;
}

export interface OddsEvent extends EventSummary {
  bookmakers: Bookmaker[];
}

export interface ScoreEvent extends EventSummary {
  completed: boolean;
  scores: { name: string; score: string }[] | null;
}

export interface OddsApi {
  /** List upcoming/live events. Does not count against the usage quota. */
  getEvents(sport: string): Promise<ApiResult<EventSummary[]>>;
  /** Moneyline, spread and total lines. Costs (markets x regions) = 3 credits with one region. */
  getOdds(sport: string): Promise<ApiResult<OddsEvent[]>>;
  /** Scores including games completed in the last `daysFrom` days. Costs 2 credits. */
  getScores(sport: string, daysFrom: number): Promise<ApiResult<ScoreEvent[]>>;
}

export const MARKETS = ['h2h', 'spreads', 'totals'];
/** Credits one odds request costs: markets x regions. */
export function oddsCallCost(regions: string): number {
  return MARKETS.length * regions.split(',').filter(Boolean).length;
}
export const SCORES_CALL_COST = 2;

export class OddsApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public usage: ApiUsage,
  ) {
    super(message);
  }
}

function headerNum(h: Headers, name: string): number | null {
  const v = h.get(name);
  if (v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function parseUsage(h: Headers): ApiUsage {
  return {
    remaining: headerNum(h, 'x-requests-remaining'),
    used: headerNum(h, 'x-requests-used'),
    last: headerNum(h, 'x-requests-last'),
  };
}

export class HttpOddsApi implements OddsApi {
  constructor(
    private apiKey: string,
    private base: string,
    private regions: string,
    private fetchImpl: typeof fetch = fetch,
  ) {
    if (!apiKey) throw new Error('ODDS_API_KEY is not set');
  }

  private async get<T>(path: string, params: Record<string, string>): Promise<ApiResult<T>> {
    const url = new URL(this.base.replace(/\/$/, '') + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set('apiKey', this.apiKey);
    const res = await this.fetchImpl(url, { headers: { accept: 'application/json' } });
    const usage = parseUsage(res.headers);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new OddsApiError(`Odds API ${path} failed: ${res.status} ${body.slice(0, 200)}`, res.status, usage);
    }
    return { data: (await res.json()) as T, usage };
  }

  getEvents(sport: string) {
    return this.get<EventSummary[]>(`/sports/${sport}/events`, { dateFormat: 'iso' });
  }

  getOdds(sport: string) {
    return this.get<OddsEvent[]>(`/sports/${sport}/odds`, {
      regions: this.regions,
      markets: MARKETS.join(','),
      oddsFormat: 'american',
      dateFormat: 'iso',
    });
  }

  getScores(sport: string, daysFrom: number) {
    return this.get<ScoreEvent[]>(`/sports/${sport}/scores`, {
      daysFrom: String(daysFrom),
      dateFormat: 'iso',
    });
  }
}
