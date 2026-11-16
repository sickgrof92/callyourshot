// Tracks Odds API credit usage and decides how much we can spend today.
//
// The source of truth is the x-requests-remaining header on our latest response.
// Each sports day gets an allowance of (remaining - reserve) / days left in the
// billing period, snapshotted the first time we look at that day. Unused credits
// therefore roll forward into later days automatically, and an expensive day
// shrinks the allowance of the days after it.

import type { Config } from './config.ts';
import type { DB } from './db.ts';
import type { ApiUsage } from './oddsApi.ts';
import { billingPeriod, DAY, sportsDay } from './time.ts';

export type BudgetMode = 'normal' | 'reserve' | 'halt';

export interface BudgetStatus {
  remaining: number;
  reserve: number;
  hardFloor: number;
  usableRemaining: number;
  periodStart: number;
  periodEnd: number;
  daysLeft: number;
  dayKey: string;
  allowanceToday: number;
  spentToday: number;
  leftToday: number;
  /** >= 1. Multiplies refresh intervals when we are spending faster than the month allows. */
  paceFactor: number;
  /**
   * normal  - refresh lines and scores as planned
   * reserve - remaining credits are inside the reserve: no line refreshes, slow score checks only (for grading)
   * halt    - at the hard floor: no API calls at all
   */
  mode: BudgetMode;
}

export function recordApiCall(
  db: DB,
  call: { at: number; endpoint: string; sport: string | null; usage: ApiUsage; expectedCost: number; ok: boolean },
): number {
  // Trust the header for cost; fall back to the documented cost if it is missing.
  const cost = call.usage.last ?? (call.ok ? call.expectedCost : 0);
  db.prepare(
    'INSERT INTO api_calls (at, endpoint, sport, cost, remaining, used, ok) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(call.at, call.endpoint, call.sport, cost, call.usage.remaining, call.usage.used, call.ok ? 1 : 0);
  return cost;
}

export function currentRemaining(db: DB, cfg: Config, now: number): number {
  const period = billingPeriod(now, cfg.billingResetDay);
  const row = db
    .prepare('SELECT remaining FROM api_calls WHERE remaining IS NOT NULL AND at >= ? ORDER BY id DESC LIMIT 1')
    .get(period.start) as { remaining: number } | undefined;
  if (row) return row.remaining;
  // No header seen yet this period: assume a fresh allowance minus what we have logged.
  const spent = db.prepare('SELECT COALESCE(SUM(cost), 0) AS s FROM api_calls WHERE at >= ?').get(period.start) as {
    s: number;
  };
  return Math.max(0, cfg.monthlyCredits - spent.s);
}

function spentBetween(db: DB, start: number, end: number): number {
  const row = db.prepare('SELECT COALESCE(SUM(cost), 0) AS s FROM api_calls WHERE at >= ? AND at < ?').get(start, end) as {
    s: number;
  };
  return row.s;
}

export function getBudgetStatus(db: DB, cfg: Config, now: number): BudgetStatus {
  const period = billingPeriod(now, cfg.billingResetDay);
  const day = sportsDay(now, cfg.timeZone, cfg.dayStartHour);
  const remaining = currentRemaining(db, cfg, now);
  const reserve = Math.round(cfg.monthlyCredits * cfg.reserveFraction);
  const hardFloor = Math.round(cfg.monthlyCredits * cfg.hardFloorFraction);
  const usableRemaining = Math.max(0, remaining - reserve);
  const daysLeft = Math.max(1, Math.ceil((period.end - Math.max(day.start, period.start)) / DAY));
  const spentToday = spentBetween(db, Math.max(day.start, period.start), day.end);

  let allowanceRow = db.prepare('SELECT allowance FROM budget_days WHERE day_key = ?').get(day.key) as
    | { allowance: number }
    | undefined;
  if (!allowanceRow) {
    // Add back anything already spent today so a mid-day restart computes the same number.
    const allowance = Math.floor((usableRemaining + spentToday) / daysLeft);
    allowanceRow = { allowance };
    // Only lock in today's number once the API has told us the real balance;
    // before the first response we are guessing from a full allowance.
    const seenHeader = db.prepare('SELECT 1 FROM api_calls WHERE remaining IS NOT NULL AND at >= ? LIMIT 1').get(period.start);
    if (seenHeader) {
      db.prepare('INSERT OR IGNORE INTO budget_days (day_key, allowance, created_at) VALUES (?, ?, ?)').run(day.key, allowance, now);
    }
  }

  // Pace check across the whole month: if we hold less of the usable budget than
  // the share of the month still ahead, stretch every interval proportionally.
  const usableTotal = Math.max(1, cfg.monthlyCredits - reserve);
  const expectedFrac = Math.min(1, Math.max(0, (period.end - now) / (period.end - period.start)));
  const actualFrac = usableRemaining / usableTotal;
  const paceFactor = actualFrac >= expectedFrac ? 1 : Math.min(4, expectedFrac / Math.max(actualFrac, 0.01));

  const mode: BudgetMode = remaining <= hardFloor ? 'halt' : remaining <= reserve ? 'reserve' : 'normal';

  return {
    remaining,
    reserve,
    hardFloor,
    usableRemaining,
    periodStart: period.start,
    periodEnd: period.end,
    daysLeft,
    dayKey: day.key,
    allowanceToday: allowanceRow.allowance,
    spentToday,
    leftToday: allowanceRow.allowance - spentToday,
    paceFactor,
    mode,
  };
}
