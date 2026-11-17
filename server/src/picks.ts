import { expectedEnd } from './gameLength.ts';
import { randomUUID } from 'node:crypto';
import { consumeAd } from './ads.ts';
import type { Config } from './config.ts';
import { tx, type DB } from './db.ts';
import type { LineRow, MarketKind, Selection } from './lines.ts';
import { entryBalance, InsufficientPointsError, postLedger } from './points.ts';

export interface PickInput {
  /** The contest this pick is made in. Points and picks only exist inside a contest. */
  competitionId: string;
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
  | {
      ok: false;
      error:
        | 'not_found'
        | 'locked'
        | 'no_line'
        | 'already_picked'
        | 'not_enough_points'
        | 'bad_amount'
        | 'pick_ad_required'
        | 'not_joined'
        | 'contest_not_live'
        | 'after_contest_end'
        | 'wrong_sport';
    }
  | { ok: false; error: 'line_moved'; line: LineRow };

const VALID: Record<MarketKind, Selection[]> = {
  moneyline: ['home', 'away'],
  spread: ['home', 'away'],
  total: ['over', 'under'],
};

export function placePick(db: DB, cfg: Config, userId: string, input: PickInput, now: number): PickResult {
  if (!VALID[input.market]?.includes(input.selection)) return { ok: false, error: 'no_line' };
  if (!Number.isInteger(input.points) || input.points < 1 || input.points > cfg.maxPickPoints) {
    return { ok: false, error: 'bad_amount' };
  }
  return tx(db, (): PickResult => {
    // Below the minimum is only allowed to use up leftover points (all of them),
    // since refills only come at exactly 0.
    if (input.points < cfg.minPickPoints && input.points !== entryBalance(db, input.competitionId, userId)) {
      return { ok: false, error: 'bad_amount' };
    }
    const ev = db.prepare('SELECT commence_time, sport FROM events WHERE id = ? AND cancelled = 0').get(input.eventId) as
      | { commence_time: number; sport: string }
      | undefined;
    if (!ev) return { ok: false, error: 'not_found' };
    // Picks lock at the scheduled start time. Pure clock check, no API call.
    if (now >= ev.commence_time) return { ok: false, error: 'locked' };

    const c = db.prepare('SELECT starts_at, ends_at, sport FROM competitions WHERE id = ?').get(input.competitionId) as
      | { starts_at: number; ends_at: number; sport: string | null }
      | undefined;
    if (!c || !db.prepare('SELECT 1 FROM competition_entries WHERE competition_id = ? AND user_id = ?').get(input.competitionId, userId)) {
      return { ok: false, error: 'not_joined' };
    }
    if (now < c.starts_at || now >= c.ends_at) return { ok: false, error: 'contest_not_live' };
    // Only games that start and finish (expected) inside the contest count in it.
    if (expectedEnd(ev.sport, ev.commence_time) > c.ends_at) return { ok: false, error: 'after_contest_end' };
    // A single-sport contest only takes picks on that sport.
    if (c.sport && ev.sport !== c.sport) return { ok: false, error: 'wrong_sport' };

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
      .prepare('SELECT 1 FROM picks WHERE competition_id = ? AND user_id = ? AND event_id = ? AND market = ?')
      .get(input.competitionId, userId, input.eventId, input.market);
    if (existing) return { ok: false, error: 'already_picked' };

    const pickId = randomUUID();
    db.prepare(
      `INSERT INTO picks (id, user_id, competition_id, event_id, market, selection, point, price, stake, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(pickId, userId, input.competitionId, input.eventId, input.market, input.selection, line.point, line.price, input.points, now);
    if (!consumeAd(db, userId, input.adSessionId, 'pick', pickId, now)) {
      db.prepare('DELETE FROM picks WHERE id = ?').run(pickId);
      return { ok: false, error: 'pick_ad_required' };
    }
    let balance: number;
    try {
      balance = postLedger(db, { userId, competitionId: input.competitionId, kind: 'pick_stake', amount: -input.points, ref: pickId, at: now });
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

export function listPicks(db: DB, userId: string, competitionId: string | null, limit = 100) {
  return db
    .prepare(
      `SELECT p.id, p.competition_id, c.name AS competition_name, p.event_id, p.market, p.selection, p.point, p.price, p.stake AS points,
              p.status, p.payout, p.created_at, p.settled_at, p.forfeited_at,
              e.sport, e.home_team, e.away_team, e.commence_time, e.home_score, e.away_score
       FROM picks p JOIN events e ON e.id = p.event_id JOIN competitions c ON c.id = p.competition_id
       WHERE p.user_id = ? AND (? IS NULL OR p.competition_id = ?) ORDER BY p.created_at DESC LIMIT ?`,
    )
    .all(userId, competitionId, competitionId, limit);
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
      .prepare('SELECT p.status, p.stake, p.competition_id, e.commence_time FROM picks p JOIN events e ON e.id = p.event_id WHERE p.id = ? AND p.user_id = ?')
      .get(pickId, userId) as { status: string; stake: number; competition_id: string; commence_time: number } | undefined;
    if (!p) return { ok: false, error: 'not_found' };
    if (p.status !== 'pending') return { ok: false, error: 'not_pending' };
    if (now < p.commence_time) return { ok: false, error: 'not_started' };
    if (!consumeAd(db, userId, adSessionId, 'forfeit', pickId, now)) return { ok: false, error: 'forfeit_ad_required' };
    const balance = postLedger(db, { userId, competitionId: p.competition_id, kind: 'pick_lost', amount: 0, ref: pickId, at: now });
    db.prepare("UPDATE picks SET status = 'lost', payout = 0, settled_at = ?, forfeited_at = ? WHERE id = ? AND status = 'pending'").run(now, now, pickId);
    return { ok: true, balance };
  });
}

export interface ChangeInput {
  market: MarketKind;
  selection: Selection;
  points: number;
  expectedPoint?: number | null;
  expectedPrice?: number;
  /** A completed "pick" ad session: changing a pick needs its own ad. */
  adSessionId?: string;
}

export type ChangeResult =
  | { ok: true; balance: number; line: LineRow }
  | { ok: false; error: 'not_found' | 'not_pending' | 'locked' | 'no_line' | 'already_picked' | 'not_enough_points' | 'bad_amount' | 'pick_ad_required' | 'contest_not_live' }
  | { ok: false; error: 'line_moved'; line: LineRow };

/**
 * Change a pending pick before its game starts: pick a different side, market
 * or amount on the same game, at the current line. It isn't a forfeit and
 * nothing is lost: the old points go back and the new amount comes out.
 * Needs one ad, like making a pick.
 */
export function changePick(db: DB, cfg: Config, userId: string, pickId: string, input: ChangeInput, now: number): ChangeResult {
  if (!VALID[input.market]?.includes(input.selection)) return { ok: false, error: 'no_line' };
  if (!Number.isInteger(input.points) || input.points < 1 || input.points > cfg.maxPickPoints) return { ok: false, error: 'bad_amount' };
  return tx(db, (): ChangeResult => {
    const p = db
      .prepare(
        `SELECT p.status, p.stake, p.market, p.competition_id, p.event_id, e.commence_time, c.starts_at, c.ends_at
         FROM picks p JOIN events e ON e.id = p.event_id JOIN competitions c ON c.id = p.competition_id WHERE p.id = ? AND p.user_id = ?`,
      )
      .get(pickId, userId) as
      | { status: string; stake: number; market: string; competition_id: string; event_id: string; commence_time: number; starts_at: number; ends_at: number }
      | undefined;
    if (!p) return { ok: false, error: 'not_found' };
    if (p.status !== 'pending') return { ok: false, error: 'not_pending' };
    if (now >= p.commence_time) return { ok: false, error: 'locked' };
    if (now < p.starts_at || now >= p.ends_at) return { ok: false, error: 'contest_not_live' };
    // What the player would have to spend from if the old pick were undone.
    const available = entryBalance(db, p.competition_id, userId) + p.stake;
    if (input.points < cfg.minPickPoints && input.points !== available) return { ok: false, error: 'bad_amount' };
    if (input.points > available) return { ok: false, error: 'not_enough_points' };

    const line = db
      .prepare('SELECT * FROM lines WHERE event_id = ? AND market = ? AND selection = ?')
      .get(p.event_id, input.market, input.selection) as LineRow | undefined;
    if (!line) return { ok: false, error: 'no_line' };
    if (
      (input.expectedPrice !== undefined && input.expectedPrice !== line.price) ||
      (input.expectedPoint !== undefined && input.expectedPoint !== line.point)
    ) {
      return { ok: false, error: 'line_moved', line };
    }
    if (
      input.market !== p.market &&
      db.prepare('SELECT 1 FROM picks WHERE competition_id = ? AND user_id = ? AND event_id = ? AND market = ?').get(p.competition_id, userId, p.event_id, input.market)
    ) {
      return { ok: false, error: 'already_picked' };
    }
    if (!consumeAd(db, userId, input.adSessionId, 'pick', `change:${pickId}:${now}`, now)) return { ok: false, error: 'pick_ad_required' };

    // One ledger entry for the difference (positive if the new amount is smaller).
    const diff = p.stake - input.points;
    const balance =
      diff === 0
        ? entryBalance(db, p.competition_id, userId)
        : postLedger(db, { userId, competitionId: p.competition_id, kind: 'pick_stake', amount: diff, ref: pickId, at: now });
    db.prepare('UPDATE picks SET market = ?, selection = ?, point = ?, price = ?, stake = ?, created_at = ? WHERE id = ?').run(
      input.market,
      input.selection,
      line.point,
      line.price,
      input.points,
      now,
      pickId,
    );
    return { ok: true, balance, line };
  });
}
