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
  minPickPoints: number;
  /** Out of points with nothing in play, and videos for points left today. */
  canEarnPoints: boolean;
  picksInPlay: number;
  pointsAdsToday: number;
  pointsAdsPerDay: number;
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
  forfeited_at: number | null;
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

export type AdPurpose = 'points' | 'pick' | 'forfeit';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public body: Record<string, unknown>,
  ) {
    super(code);
  }
}

// Long enough for a free-tier server to wake from sleep (can take ~50s).
const TIMEOUT_MS = 70_000;

async function request<T>(path: string, opts: { method?: string; body?: unknown; token?: string | null } = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const res = await fetch(`${API_URL}${path}`, {
    signal: controller.signal,
    method: opts.method ?? 'GET',
    headers: {
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  }).finally(() => clearTimeout(timer));
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
    body: {
      eventId: string;
      market: Market;
      selection: Selection;
      points: number;
      expectedPoint: number | null;
      expectedPrice: number;
      adSessionId: string;
    },
  ) => request<{ pickId: string; balance: number }>('/picks', { method: 'POST', body, token }),
  myPicks: (token: string) => request<{ picks: Pick[] }>('/picks', { token }),
  forfeitPick: (token: string, pickId: string, adSessionId: string) =>
    request<{ balance: number }>(`/picks/${pickId}/forfeit`, { method: 'POST', body: { adSessionId }, token }),
  startAd: (token: string, purpose: AdPurpose) =>
    request<{ sessionId: string; rewardPoints: number; provider: 'stub' | 'admob' }>('/ads/sessions', {
      method: 'POST',
      body: { purpose },
      token,
    }),
  adStatus: (token: string, id: string) => request<{ rewarded: boolean; balance: number }>(`/ads/sessions/${id}`, { token }),
  completeStubAd: (token: string, id: string) =>
    request<{ rewarded: boolean; balance: number }>(`/ads/sessions/${id}/stub-complete`, { method: 'POST', token }),
  leaderboard: (period: 'weekly' | 'monthly', token: string | null) =>
    request<Leaderboard>(`/leaderboard?period=${period}`, { token }),
};
