// Talks to the Call Your Shot server. The app never calls the lines provider directly.

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8080').replace(/\/$/, '');

export type Market = 'moneyline' | 'spread' | 'total';
export type Selection = 'home' | 'away' | 'over' | 'under';

export interface LineQuote {
  point: number | null;
  price: number;
  /** Points returned per point used, if the pick wins. */
  payout: number;
}

export interface Game {
  id: string;
  sport: string;
  homeTeam: string;
  awayTeam: string;
  startsAt: string;
  locked: boolean;
  linesUpdatedAt: string | null;
  lines: Partial<Record<Market, Partial<Record<Selection, LineQuote>>>>;
}

export interface Me {
  id: string;
  displayName: string;
  balance: number;
  adsWatchedToday: number;
  adDailyCap: number;
  adRewardPoints: number;
  weeklyScore: number;
  monthlyScore: number;
}

export interface Pick {
  id: string;
  event_id: string;
  market: Market;
  selection: Selection;
  point: number | null;
  price: number;
  points: number;
  status: 'pending' | 'won' | 'lost' | 'push' | 'void';
  payout: number | null;
  sport: string;
  home_team: string;
  away_team: string;
  commence_time: number;
  home_score: number | null;
  away_score: number | null;
}

export interface Leaderboard {
  period: { key: string; type: 'weekly' | 'monthly'; startsAt: string; endsAt: string };
  prize: { title: string; description: string; announcedAt: string } | null;
  standings: { rank: number; displayName: string; score: number }[];
  me: { score: number; rank: number | null } | null;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public body: Record<string, unknown>,
  ) {
    super(code);
  }
}

async function request<T>(path: string, opts: { method?: string; body?: unknown; token?: string | null } = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(res.status, String(json.error ?? 'error'), json);
  return json as T;
}

export const api = {
  signUp: (displayName: string) =>
    request<{ token: string; user: { id: string; displayName: string } }>('/auth/guest', { method: 'POST', body: { displayName } }),
  me: (token: string) => request<Me>('/me', { token }),
  sports: () => request<{ key: string; label: string }[]>('/sports'),
  lines: (sport: string) => request<{ sport: string; events: Game[] }>(`/lines?sport=${encodeURIComponent(sport)}`),
  makePick: (
    token: string,
    body: { eventId: string; market: Market; selection: Selection; points: number; expectedPoint: number | null; expectedPrice: number },
  ) => request<{ pickId: string; balance: number }>('/picks', { method: 'POST', body, token }),
  myPicks: (token: string) => request<{ picks: Pick[] }>('/picks', { token }),
  startAd: (token: string) =>
    request<{ sessionId: string; rewardPoints: number; provider: 'stub' | 'admob' }>('/ads/sessions', { method: 'POST', token }),
  adStatus: (token: string, id: string) => request<{ rewarded: boolean; balance: number }>(`/ads/sessions/${id}`, { token }),
  completeStubAd: (token: string, id: string) =>
    request<{ rewarded: boolean; balance: number }>(`/ads/sessions/${id}/stub-complete`, { method: 'POST', token }),
  leaderboard: (period: 'weekly' | 'monthly', token: string | null) =>
    request<Leaderboard>(`/leaderboard?period=${period}`, { token }),
};
