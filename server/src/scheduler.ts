// Decides when to spend Odds API credits.
//
// Rules (see README "Credit budget"):
//  - Only sports with games still to start in today's sports day get line refreshes.
//  - Far from the next game (> 3h) lines refresh rarely (every 4h). Inside the
//    3 hours before a game they refresh every 30 min.
//  - Scores are only fetched for sports that have ungraded picks on games that
//    should be over by now.
//  - Every interval is stretched by a pressure factor when the rest of today's
//    plan would overspend today's allowance, or when the month is running hot.
//  - When remaining credits drop into the reserve, line refreshes stop and
//    score checks slow to every 2h so picks still get graded. At the hard floor
//    everything stops.
// Locking picks at commence_time needs no API call at all.

import type { BudgetStatus } from './budget.ts';
import { currentRemaining, getBudgetStatus, recordApiCall } from './budget.ts';
import type { Config } from './config.ts';
import type { DB } from './db.ts';
import { gradeEvent, voidStalePicks } from './grading.ts';
import { applyScores, ingestOdds, upsertEvents } from './lines.ts';
import { OddsApiError, oddsCallCost, SCORES_CALL_COST, type ApiUsage, type OddsApi } from './oddsApi.ts';
import { DAY, HOUR, sportsDay } from './time.ts';

const MIN = 60_000;
export const NEAR_WINDOW = 3 * HOUR;
export const NEAR_INTERVAL = 30 * MIN;
export const FAR_INTERVAL = 4 * HOUR;
export const SCORES_INTERVAL = 30 * MIN;
export const RESERVE_SCORES_INTERVAL = 2 * HOUR;
export const EVENTS_INTERVAL = 6 * HOUR;
export const MAX_PRESSURE = 8;

/** Rough real-world game lengths, used to know when a final score could exist. */
export const GAME_LENGTH: Record<string, number> = {
  americanfootball_nfl: 3 * HOUR + 10 * MIN,
  americanfootball_ncaaf: 3 * HOUR + 20 * MIN,
  basketball_nba: 2 * HOUR + 20 * MIN,
  basketball_ncaab: 2 * HOUR,
  icehockey_nhl: 2 * HOUR + 30 * MIN,
};
const DEFAULT_GAME_LENGTH = 3 * HOUR;
export const gameLength = (sport: string) => GAME_LENGTH[sport] ?? DEFAULT_GAME_LENGTH;

/**
 * When the next line refresh is due, given the last refresh and the next game to start.
 * Returns -Infinity if never refreshed (due now).
 */
export function nextOddsDue(lastAt: number | null, nextStart: number, pressure: number): number {
  if (lastAt === null) return -Infinity;
  if (nextStart - lastAt <= NEAR_WINDOW) return lastAt + NEAR_INTERVAL * pressure;
  // Far phase: wait FAR_INTERVAL, but always wake up when the near window opens.
  return Math.min(lastAt + FAR_INTERVAL * pressure, nextStart - NEAR_WINDOW);
}

/** How many line refreshes the plan above makes between now and the last start of the day. */
export function estimateOddsCalls(startsToday: number[], lastAt: number | null, now: number): number {
  const starts = [...startsToday].sort((a, b) => a - b);
  let t = now;
  let last = lastAt;
  let count = 0;
  for (let i = 0; i < 500; i++) {
    const upcoming = starts.find((s) => s > t);
    if (upcoming === undefined) break;
    const due = Math.max(t, nextOddsDue(last, upcoming, 1));
    if (!starts.some((s) => s > due)) break;
    count++;
    last = due;
    t = due;
  }
  return count;
}

/** Score checks still expected today for games that have pending picks. */
export function estimateScoresCalls(pendingStarts: number[], sport: string, now: number): number {
  if (pendingStarts.length === 0) return 0;
  const len = gameLength(sport);
  const firstEnd = Math.min(...pendingStarts) + len;
  const lastEnd = Math.max(...pendingStarts) + len + HOUR;
  const from = Math.max(now, firstEnd);
  if (from > lastEnd) return 1;
  return Math.ceil((lastEnd - from) / SCORES_INTERVAL) + 1;
}

export interface SportPlan {
  sport: string;
  startsToday: number[];
  upcomingToday: number[];
  lastOddsAt: number | null;
  lastScoresAt: number | null;
  lastEventsAt: number | null;
  /** Commence times of not-yet-graded events that have pending picks. */
  pendingStarts: number[];
}

export interface Decision {
  events: string[];
  odds: string[];
  scores: { sport: string; daysFrom: number }[];
  pressure: number;
  estimatedCost: number;
  budget: BudgetStatus;
}

/** Pure planning step: given state and budget, which calls should we make right now? */
export function decide(plans: SportPlan[], budget: BudgetStatus, now: number, cfg: Config): Decision {
  const oddsCost = oddsCallCost(cfg.oddsRegions);

  // Events listings are free, so refresh them on a timer regardless of budget (except at the hard floor).
  const events =
    budget.mode === 'halt'
      ? []
      : plans.filter((p) => p.lastEventsAt === null || now - p.lastEventsAt >= EVENTS_INTERVAL).map((p) => p.sport);

  if (budget.allowanceToday < LEAN_ALLOWANCE) return decideLean(plans, budget, now, cfg, events);

  let estimatedCost = 0;
  for (const p of plans) {
    estimatedCost += estimateOddsCalls(p.upcomingToday, p.lastOddsAt, now) * oddsCost;
    const ready = p.pendingStarts.filter((s) => s > now - DAY);
    estimatedCost += estimateScoresCalls(ready, p.sport, now) * SCORES_CALL_COST;
  }
  const dailyPressure = budget.leftToday > 0 ? estimatedCost / budget.leftToday : MAX_PRESSURE;
  const pressure = Math.min(MAX_PRESSURE, Math.max(1, dailyPressure) * budget.paceFactor);

  const odds: string[] = [];
  const scores: { sport: string; daysFrom: number }[] = [];
  if (budget.mode === 'halt') return { events, odds, scores, pressure, estimatedCost, budget };

  const linesAllowed = budget.mode === 'normal' && budget.leftToday >= oddsCost;
  for (const p of plans) {
    if (!linesAllowed) break;
    const nextStart = p.upcomingToday.find((s) => s > now);
    if (nextStart === undefined) continue; // no games left today: no line refresh
    if (now >= nextOddsDue(p.lastOddsAt, nextStart, pressure)) odds.push(p.sport);
  }

  // Score checks keep running out of the reserve (slowly) so picks always get graded.
  const slowScores = budget.mode === 'reserve' || budget.leftToday < SCORES_CALL_COST;
  const scoresInterval = slowScores ? RESERVE_SCORES_INTERVAL : Math.min(RESERVE_SCORES_INTERVAL, SCORES_INTERVAL * pressure);
  for (const p of plans) {
    const finished = p.pendingStarts.filter((s) => s + gameLength(p.sport) <= now);
    if (finished.length === 0) continue;
    if (p.lastScoresAt !== null && now - p.lastScoresAt < scoresInterval) continue;
    const oldest = Math.min(...finished);
    const daysFrom = Math.min(3, Math.max(1, Math.ceil((now - oldest) / DAY)));
    scores.push({ sport: p.sport, daysFrom });
  }

  return { events, odds, scores, pressure, estimatedCost, budget };
}

// ---- Lean mode -------------------------------------------------------------
// For small plans (e.g. the free tier's 500 credits/month, ~15/day) the normal
// schedule would spend the whole day's allowance at 5 AM. Instead:
//  - each day, pick which sports get a line refresh, busiest slate first, as
//    many as fit after setting aside credits for grading;
//  - refresh each chosen sport once, about 2 hours before its first game;
//  - fetch scores at most once per sport every 6 hours, after its pending
//    games for the day should be over (or once a result has waited 12 hours).
// Sports skipped today keep the lines from their last refresh (lines for
// future games come back with every refresh of that sport).

/** Below this daily allowance (credits) the scheduler switches to lean mode. */
export const LEAN_ALLOWANCE = 60;
export const LEAN_LINES_LEAD = 2 * HOUR;
export const LEAN_SCORES_GAP = 6 * HOUR;
export const LEAN_SCORES_MAX_WAIT = 12 * HOUR;

/** Sports that get today's single line refresh in lean mode, busiest first. */
export function leanLineSports(plans: SportPlan[], allowanceToday: number, oddsCost: number): string[] {
  const playing = plans.filter((p) => p.startsToday.length > 0).sort((a, b) => b.startsToday.length - a.startsToday.length);
  // Keep up to half the day's credits for grading: one scores call per sport playing today.
  const scoresReserve = Math.min(Math.floor(allowanceToday / 2), SCORES_CALL_COST * playing.length);
  const slots = Math.max(0, Math.floor((allowanceToday - scoresReserve) / oddsCost));
  return playing.slice(0, Math.max(slots, allowanceToday >= oddsCost ? 1 : 0)).map((p) => p.sport);
}

function decideLean(plans: SportPlan[], budget: BudgetStatus, now: number, cfg: Config, events: string[]): Decision {
  const oddsCost = oddsCallCost(cfg.oddsRegions);
  const odds: string[] = [];
  const scores: { sport: string; daysFrom: number }[] = [];
  const base = { events, odds, scores, pressure: 1, estimatedCost: 0, budget };
  if (budget.mode === 'halt') return base;

  // Grading first: picks must always settle, even out of the reserve.
  for (const p of plans) {
    const len = gameLength(p.sport);
    const finished = p.pendingStarts.filter((s) => s + len <= now);
    if (finished.length === 0) continue;
    if (p.lastScoresAt !== null && now - p.lastScoresAt < LEAN_SCORES_GAP) continue;
    const stillPlaying = p.pendingStarts.some((s) => s + len > now);
    const oldestWait = now - (Math.min(...finished) + len);
    if (stillPlaying && oldestWait < LEAN_SCORES_MAX_WAIT) continue;
    const daysFrom = Math.min(3, Math.max(1, Math.ceil((now - Math.min(...finished)) / DAY)));
    scores.push({ sport: p.sport, daysFrom });
  }

  if (budget.mode !== 'normal') return base;
  const day = sportsDay(now, cfg.timeZone, cfg.dayStartHour);
  let left = budget.leftToday - scores.length * SCORES_CALL_COST;
  for (const sport of leanLineSports(plans, budget.allowanceToday, oddsCost)) {
    const p = plans.find((x) => x.sport === sport)!;
    if (p.lastOddsAt !== null && p.lastOddsAt >= day.start) continue; // already refreshed today
    const first = p.upcomingToday[0];
    if (first === undefined || now < first - LEAN_LINES_LEAD) continue;
    if (left < oddsCost) break;
    odds.push(sport);
    left -= oddsCost;
  }
  return base;
}

export function buildPlans(db: DB, cfg: Config, now: number): SportPlan[] {
  const day = sportsDay(now, cfg.timeZone, cfg.dayStartHour);
  const startsStmt = db.prepare('SELECT commence_time AS t FROM events WHERE sport = ? AND commence_time >= ? AND commence_time < ?');
  const pendingStmt = db.prepare(
    `SELECT DISTINCT e.commence_time AS t FROM picks p JOIN events e ON e.id = p.event_id
     WHERE p.status = 'pending' AND e.completed = 0 AND e.sport = ?`,
  );
  const stateStmt = db.prepare('SELECT last_odds_at, last_scores_at, last_events_at FROM sport_state WHERE sport = ?');
  return cfg.sports.map((sport) => {
    const startsToday = (startsStmt.all(sport, day.start, day.end) as { t: number }[]).map((r) => r.t);
    const st = stateStmt.get(sport) as
      | { last_odds_at: number | null; last_scores_at: number | null; last_events_at: number | null }
      | undefined;
    return {
      sport,
      startsToday,
      upcomingToday: startsToday.filter((t) => t > now),
      lastOddsAt: st?.last_odds_at ?? null,
      lastScoresAt: st?.last_scores_at ?? null,
      lastEventsAt: st?.last_events_at ?? null,
      pendingStarts: (pendingStmt.all(sport) as { t: number }[]).map((r) => r.t),
    };
  });
}

function setState(db: DB, sport: string, col: 'last_odds_at' | 'last_scores_at' | 'last_events_at', at: number) {
  db.prepare(`INSERT INTO sport_state (sport, ${col}) VALUES (?, ?) ON CONFLICT(sport) DO UPDATE SET ${col} = excluded.${col}`).run(
    sport,
    at,
  );
}

export interface Logger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
}

export interface TickResult {
  decision: Decision;
  graded: number;
  voided: number;
  errors: string[];
}

/** One scheduler pass. Safe to call every minute; it only spends credits when something is due. */
export async function tick(db: DB, cfg: Config, api: OddsApi, now: number, log?: Logger): Promise<TickResult> {
  const errors: string[] = [];
  const voided = voidStalePicks(db, now);
  const budget = getBudgetStatus(db, cfg, now);
  const decision = decide(buildPlans(db, cfg, now), budget, now, cfg);

  async function call<T>(
    endpoint: string,
    sport: string,
    expectedCost: number,
    fn: () => Promise<{ data: T; usage: ApiUsage }>,
  ): Promise<T | null> {
    try {
      const { data, usage } = await fn();
      recordApiCall(db, { at: now, endpoint, sport, usage, expectedCost, ok: true });
      return data;
    } catch (err) {
      const usage = err instanceof OddsApiError ? err.usage : { remaining: null, used: null, last: null };
      recordApiCall(db, { at: now, endpoint, sport, usage, expectedCost, ok: false });
      errors.push(`${endpoint} ${sport}: ${(err as Error).message}`);
      log?.warn({ err, endpoint, sport }, 'Odds API call failed');
      return null;
    }
  }

  for (const sport of decision.events) {
    const data = await call('events', sport, 0, () => api.getEvents(sport));
    if (data) upsertEvents(db, data, now);
    setState(db, sport, 'last_events_at', now);
  }

  // Events may have changed today's schedule; re-plan line refreshes with fresh data.
  const odds = decision.events.length > 0 ? decide(buildPlans(db, cfg, now), budget, now, cfg).odds : decision.odds;
  decision.odds = odds;

  // Each response tells us the true remaining credits, so re-check between calls
  // in case we just crossed into the reserve.
  const remainingNow = () => currentRemaining(db, cfg, now);
  for (const sport of odds) {
    if (remainingNow() <= budget.reserve) break;
    const data = await call('odds', sport, oddsCallCost(cfg.oddsRegions), () => api.getOdds(sport));
    if (data) ingestOdds(db, data, cfg.preferredBooks, now);
    setState(db, sport, 'last_odds_at', now);
  }

  let graded = 0;
  for (const { sport, daysFrom } of decision.scores) {
    if (remainingNow() <= budget.hardFloor) break;
    const data = await call('scores', sport, SCORES_CALL_COST, () => api.getScores(sport, daysFrom));
    setState(db, sport, 'last_scores_at', now);
    if (!data) continue;
    for (const id of applyScores(db, data, now)) graded += gradeEvent(db, id, now);
  }
  // Catch events completed earlier whose picks were not graded (e.g. a crash mid-tick).
  const leftover = db
    .prepare("SELECT DISTINCT p.event_id AS id FROM picks p JOIN events e ON e.id = p.event_id WHERE p.status = 'pending' AND e.completed = 1")
    .all() as { id: string }[];
  for (const { id } of leftover) graded += gradeEvent(db, id, now);

  if (odds.length || decision.scores.length) {
    log?.info(
      { odds, scores: decision.scores, pressure: decision.pressure.toFixed(2), budget: { remaining: budget.remaining, leftToday: budget.leftToday, mode: budget.mode } },
      'scheduler tick',
    );
  }
  return { decision, graded, voided, errors };
}

export function startScheduler(db: DB, cfg: Config, api: OddsApi, log?: Logger): () => void {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await tick(db, cfg, api, Date.now(), log);
    } catch (err) {
      log?.warn({ err }, 'scheduler tick crashed');
    } finally {
      running = false;
    }
  };
  void run();
  const handle = setInterval(run, cfg.schedulerTickSeconds * 1000);
  return () => clearInterval(handle);
}
