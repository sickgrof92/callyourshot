import { randomUUID } from 'node:crypto';
import { consumeAd } from './ads.ts';
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
  /** A completed "pick" ad session. Every pick needs its own ad. */
  adSessionId?: string;
}

export type PickResult =
  | { ok: true; pickId: string; balance: number; line: LineRow }
  | { ok: false; error: 'not_found' | 'locked' | 'no_line' | 'already_picked' | 'not_enough_points' | 'bad_amount' | 'pick_ad_required' }
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
    if (!consumeAd(db, userId, input.adSessionId, 'pick', pickId, now)) {
      db.prepare('DELETE FROM picks WHERE id = ?').run(pickId);
      return { ok: false, error: 'pick_ad_required' };
    }
    let balance: number;
    try {
      balance = postLedger(db, { userId, kind: 'pick_stake', amount: -input.points, scoreDelta: 0, ref: pickId, at: now });
    } catch (err) {
      if (err instanceof InsufficientPointsError) {
        db.prepare('DELETE FROM picks WHERE id = ?').run(pickId);
        // Leave the ad unused so the player can retry after a reload.
        db.prepare('UPDATE ad_sessions SET used_at = NULL, used_for = NULL WHERE id = ?').run(input.adSessionId ?? '');
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
              p.created_at, p.settled_at, p.forfeited_at, e.sport, e.home_team, e.away_team, e.commence_time, e.home_score, e.away_score
       FROM picks p JOIN events e ON e.id = p.event_id
       WHERE p.user_id = ? ORDER BY p.created_at DESC LIMIT ?`,
    )
    .all(userId, limit);
}

export type ForfeitResult = { ok: true; balance: number } | { ok: false; error: 'not_found' | 'not_started' | 'not_pending' | 'forfeit_ad_required' };

/**
 * Give up a pending pick as a loss, after watching a forfeit ad. Only allowed
 * once the game has started and until the pick is graded. The points
 * already used on the pick are gone for good: nothing is refunded. This lets a
 * player who knows a pick is losing get back to 0 and watch for new points.
 */
export function forfeitPick(db: DB, userId: string, pickId: string, adSessionId: string | undefined, now: number): ForfeitResult {
  return tx(db, (): ForfeitResult => {
    const p = db
      .prepare('SELECT p.status, p.stake, e.commence_time FROM picks p JOIN events e ON e.id = p.event_id WHERE p.id = ? AND p.user_id = ?')
      .get(pickId, userId) as { status: string; stake: number; commence_time: number } | undefined;
    if (!p) return { ok: false, error: 'not_found' };
    if (p.status !== 'pending') return { ok: false, error: 'not_pending' };
    if (now < p.commence_time) return { ok: false, error: 'not_started' };
    if (!consumeAd(db, userId, adSessionId, 'forfeit', pickId, now)) return { ok: false, error: 'forfeit_ad_required' };
    const balance = postLedger(db, { userId, kind: 'pick_lost', amount: 0, scoreDelta: -p.stake, ref: pickId, at: now, scoreAt: p.commence_time });
    db.prepare("UPDATE picks SET status = 'lost', payout = 0, settled_at = ?, forfeited_at = ? WHERE id = ? AND status = 'pending'").run(now, now, pickId);
    return { ok: true, balance };
  });
}
