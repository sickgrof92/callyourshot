// Weekly and monthly leaderboards, plus the fixed prizes announced for them.
//
// A user's score for a period is the points they gained in it: ad rewards plus
// net results of picks on games that started in it. Ties go to whoever reached
// the score first.

import { randomUUID } from 'node:crypto';
import type { DB } from './db.ts';
import { periodFromKey, periodWindow, type PeriodType, type Window } from './time.ts';

export interface Standing {
  rank: number;
  userId: string;
  displayName: string;
  score: number;
}

export function standings(db: DB, window: Window, limit = 100): Standing[] {
  const rows = db
    .prepare(
      `SELECT l.user_id AS userId, u.display_name AS displayName, SUM(l.score_delta) AS score, MAX(l.score_at) AS lastAt
       FROM ledger l JOIN users u ON u.id = l.user_id
       WHERE l.score_at >= ? AND l.score_at < ?
       GROUP BY l.user_id
       ORDER BY score DESC, lastAt ASC
       LIMIT ?`,
    )
    .all(window.start, window.end, limit) as { userId: string; displayName: string; score: number }[];
  return rows.map((r, i) => ({ rank: i + 1, userId: r.userId, displayName: r.displayName, score: r.score }));
}

export function userScore(db: DB, window: Window, userId: string): number {
  const row = db
    .prepare('SELECT COALESCE(SUM(score_delta), 0) AS s FROM ledger WHERE user_id = ? AND score_at >= ? AND score_at < ?')
    .get(userId, window.start, window.end) as { s: number };
  return row.s;
}

export interface Prize {
  id: string;
  period_key: string;
  title: string;
  description: string;
  announced_at: number;
  winner_user_id: string | null;
  finalized_at: number | null;
}

export function prizeFor(db: DB, periodKey: string): Prize | null {
  return (db.prepare('SELECT * FROM prizes WHERE period_key = ?').get(periodKey) as Prize | undefined) ?? null;
}

export type AnnounceResult = { ok: true; prize: Prize } | { ok: false; error: string };

/**
 * Announce a fixed prize. Allowed only before the period starts, so the prize is
 * always known in advance and cannot be changed once play begins.
 */
export function announcePrize(
  db: DB,
  tz: string,
  input: { periodKey: string; title: string; description: string },
  now: number,
): AnnounceResult {
  let period;
  try {
    period = periodFromKey(input.periodKey, tz);
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  if (now >= period.start) return { ok: false, error: 'Prizes must be announced before the period starts' };
  if (prizeFor(db, input.periodKey)) return { ok: false, error: 'A prize is already announced for this period' };
  const prize: Prize = {
    id: randomUUID(),
    period_key: input.periodKey,
    title: input.title,
    description: input.description,
    announced_at: now,
    winner_user_id: null,
    finalized_at: null,
  };
  db.prepare('INSERT INTO prizes (id, period_key, title, description, announced_at) VALUES (?, ?, ?, ?, ?)').run(
    prize.id,
    prize.period_key,
    prize.title,
    prize.description,
    prize.announced_at,
  );
  return { ok: true, prize };
}

/** Record the winner once the period is over. */
export function finalizePrize(db: DB, tz: string, periodKey: string, now: number): AnnounceResult {
  const prize = prizeFor(db, periodKey);
  if (!prize) return { ok: false, error: 'No prize for this period' };
  if (prize.finalized_at) return { ok: true, prize };
  const period = periodFromKey(periodKey, tz);
  if (now < period.end) return { ok: false, error: 'Period has not ended yet' };
  const pending = db
    .prepare(
      `SELECT COUNT(*) AS n FROM picks p JOIN events e ON e.id = p.event_id
       WHERE p.status = 'pending' AND e.commence_time < ?`,
    )
    .get(period.end) as { n: number };
  if (pending.n > 0) return { ok: false, error: `${pending.n} picks from this period are still waiting to be graded` };
  const top = standings(db, period, 1)[0];
  db.prepare('UPDATE prizes SET winner_user_id = ?, finalized_at = ? WHERE id = ?').run(top?.userId ?? null, now, prize.id);
  return { ok: true, prize: prizeFor(db, periodKey)! };
}

export function currentPeriods(now: number, tz: string): Record<PeriodType, Window> {
  return { weekly: periodWindow('weekly', now, tz), monthly: periodWindow('monthly', now, tz) };
}
