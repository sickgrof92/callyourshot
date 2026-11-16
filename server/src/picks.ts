import { randomUUID } from 'node:crypto';
import type { Config } from './config.ts';
import { tx, type DB } from './db.ts';
import type { LineRow, MarketKind, Selection } from './lines.ts';
import { InsufficientPointsError, postLedger } from './points.ts';

export interface PickInput {
  eventId: string;
  market: MarketKind;
  selection: Selection;
  points: number;
  /** The line the user saw. If it has moved since, we refuse and return the new one. */
  expectedPoint?: number | null;
  expectedPrice?: number;
}

export type PickResult =
  | { ok: true; pickId: string; balance: number; line: LineRow }
  | { ok: false; error: 'not_found' | 'locked' | 'no_line' | 'already_picked' | 'not_enough_points' | 'bad_amount' }
  | { ok: false; error: 'line_moved'; line: LineRow };

const VALID: Record<MarketKind, Selection[]> = {
  moneyline: ['home', 'away'],
  spread: ['home', 'away'],
  total: ['over', 'under'],
};

export function placePick(db: DB, cfg: Config, userId: string, input: PickInput, now: number): PickResult {
  if (!VALID[input.market]?.includes(input.selection)) return { ok: false, error: 'no_line' };
  if (!Number.isInteger(input.points) || input.points < cfg.minPickPoints || input.points > cfg.maxPickPoints) {
    return { ok: false, error: 'bad_amount' };
  }
  return tx(db, (): PickResult => {
    const ev = db.prepare('SELECT commence_time FROM events WHERE id = ?').get(input.eventId) as
      | { commence_time: number }
      | undefined;
    if (!ev) return { ok: false, error: 'not_found' };
    // Picks lock at the scheduled start time. Pure clock check, no API call.
    if (now >= ev.commence_time) return { ok: false, error: 'locked' };

    const line = db
      .prepare('SELECT * FROM lines WHERE event_id = ? AND market = ? AND selection = ?')
      .get(input.eventId, input.market, input.selection) as LineRow | undefined;
    if (!line) return { ok: false, error: 'no_line' };
    if (
      (input.expectedPrice !== undefined && input.expectedPrice !== line.price) ||
      (input.expectedPoint !== undefined && input.expectedPoint !== line.point)
    ) {
      return { ok: false, error: 'line_moved', line };
    }

    const existing = db
      .prepare('SELECT 1 FROM picks WHERE user_id = ? AND event_id = ? AND market = ?')
      .get(userId, input.eventId, input.market);
    if (existing) return { ok: false, error: 'already_picked' };

    const pickId = randomUUID();
    db.prepare(
      `INSERT INTO picks (id, user_id, event_id, market, selection, point, price, stake, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(pickId, userId, input.eventId, input.market, input.selection, line.point, line.price, input.points, now);
    let balance: number;
    try {
      balance = postLedger(db, { userId, kind: 'pick_stake', amount: -input.points, scoreDelta: 0, ref: pickId, at: now });
    } catch (err) {
      if (err instanceof InsufficientPointsError) {
        db.prepare('DELETE FROM picks WHERE id = ?').run(pickId);
        return { ok: false, error: 'not_enough_points' };
      }
      throw err;
    }
    return { ok: true, pickId, balance, line };
  });
}

export function listPicks(db: DB, userId: string, limit = 100) {
  return db
    .prepare(
      `SELECT p.id, p.event_id, p.market, p.selection, p.point, p.price, p.stake AS points, p.status, p.payout,
              p.created_at, p.settled_at, e.sport, e.home_team, e.away_team, e.commence_time, e.home_score, e.away_score
       FROM picks p JOIN events e ON e.id = p.event_id
       WHERE p.user_id = ? ORDER BY p.created_at DESC LIMIT ?`,
    )
    .all(userId, limit);
}
