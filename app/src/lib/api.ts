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
  minPickPoints: number;
  maxPickPoints: number;
  pointsAdsPerDay: number;
  adRewardPoints: number;
}

/** A player's own state inside one contest. */
export interface MyEntry {
  balance: number;
  picksInPlay: number;
  /** Out of points with nothing in play, and refills left today. */
  canEarnPoints: boolean;
  pointsAdsToday: number;
  pointsAdsPerDay: number;
}

export interface Pick {
  id: string;
  competition_id: string;
  competition_name: string;
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

export type ContestKind = 'daily' | 'weekly' | 'monthly';

export interface Contest {
  id: string;
  name: string;
  kind: ContestKind;
  prize: string;
  prizeDetails: string;
  maxEntries: number;
  entries: number;
  startsAt: string;
  endsAt: string;
  status: 'upcoming' | 'live' | 'ended';
  joined: boolean;
  winner: string | null;
  /** My prize claim if I won: pending, submitted, verified, paid, ineligible, rejected. */
  claim: string | null;
  mine: MyEntry | null;
}

export interface PlayerStats {
  displayName: string;
  joinedAt: string;
  wins: number;
  losses: number;
  ties: number;
  winPct: number | null;
  longestWinStreak: number;
  currentWinStreak: number;
  reloads: number;
  contestsJoined: number;
  contestsWon: number;
}

export interface ClaimInfo {
  status: string;
  note: string;
  prize: string;
  country: 'US' | 'CA';
  region: string;
  needsTaxId: boolean;
  skillQuestion: string | null;
}

export interface ClaimForm {
  legalName: string;
  address: { line1: string; line2?: string; city: string; region: string; postalCode: string; country: 'US' | 'CA' };
  birthDate: string;
  taxId?: string;
  skillAnswer?: number;
}

export interface ContestDetail {
  competition: Contest;
  standings: { rank: number; displayName: string; score: number }[];
  me: { rank: number; score: number } | null;
}

export type NotifyKind = 'contestStart' | 'gameStart' | 'results' | 'newContests';
export type NotifyPrefs = Record<NotifyKind, boolean> & { pushEnabled: boolean };

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
  authConfig: () => request<{ mode: 'stub' | 'live' }>('/auth/config'),
  signIn: (body: { provider: 'apple' | 'google'; idToken: string; profile?: { displayName: string; email: string; phone: string; country: 'US' | 'CA'; region: string; acceptedTerms: true } }) =>
    request<{ token: string; user: { id: string; displayName: string } } | { needsProfile: true; email: string | null }>('/auth/signin', {
      method: 'POST',
      body,
    }),
  me: (token: string) => request<Me>('/me', { token }),
  sports: () => request<{ key: string; label: string }[]>('/sports'),
  lines: (sport: string) => request<{ sport: string; events: Game[] }>(`/lines?sport=${encodeURIComponent(sport)}`),
  makePick: (
    token: string,
    body: {
      competitionId: string;
      eventId: string;
      market: Market;
      selection: Selection;
      points: number;
      expectedPoint: number | null;
      expectedPrice: number;
      adSessionId: string;
    },
  ) => request<{ pickId: string; balance: number }>('/picks', { method: 'POST', body, token }),
  myPicks: (token: string, competitionId?: string) =>
    request<{ picks: Pick[] }>(`/picks${competitionId ? `?competitionId=${encodeURIComponent(competitionId)}` : ''}`, { token }),
  forfeitPick: (token: string, pickId: string, adSessionId: string) =>
    request<{ balance: number }>(`/picks/${pickId}/forfeit`, { method: 'POST', body: { adSessionId }, token }),
  startAd: (token: string, purpose: AdPurpose, competitionId?: string) =>
    request<{ sessionId: string; rewardPoints: number; provider: 'stub' | 'admob' }>('/ads/sessions', {
      method: 'POST',
      body: { purpose, competitionId },
      token,
    }),
  adStatus: (token: string, id: string) => request<{ rewarded: boolean; balance: number }>(`/ads/sessions/${id}`, { token }),
  completeStubAd: (token: string, id: string) =>
    request<{ rewarded: boolean; balance: number }>(`/ads/sessions/${id}/stub-complete`, { method: 'POST', token }),
  contests: (token: string | null) => request<{ competitions: Contest[] }>('/competitions', { token }),
  contest: (id: string, token: string | null) => request<ContestDetail>(`/competitions/${encodeURIComponent(id)}`, { token }),
  notifyPrefs: (token: string) => request<NotifyPrefs>('/me/notifications', { token }),
  setNotifyPrefs: (token: string, prefs: Partial<Record<NotifyKind, boolean>>) =>
    request<NotifyPrefs>('/me/notifications', { method: 'PUT', body: prefs, token }),
  setPushToken: (token: string, pushToken: string | null) =>
    request<NotifyPrefs>('/me/push-token', { method: 'POST', body: { token: pushToken }, token }),
  player: (name: string) => request<PlayerStats>(`/players/${encodeURIComponent(name)}`),
  claimInfo: (token: string, id: string) => request<ClaimInfo>(`/competitions/${encodeURIComponent(id)}/claim`, { token }),
  submitClaim: (token: string, id: string, body: ClaimForm) =>
    request<{ status: string }>(`/competitions/${encodeURIComponent(id)}/claim`, { method: 'POST', body, token }),
  joinContest: (token: string, id: string) =>
    request<{ joined: true }>(`/competitions/${encodeURIComponent(id)}/join`, { method: 'POST', token }),
};
