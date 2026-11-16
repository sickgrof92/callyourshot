// Grades pending picks once a game's final score is in.

import { tx, type DB } from './db.ts';
import { postLedger, winPayout } from './points.ts';
import { DAY } from './time.ts';

export type Outcome = 'won' | 'lost' | 'push';

export interface GradablePick {
  market: string;
  selection: string;
  point: number | null;
}

export function gradePick(pick: GradablePick, homeScore: number, awayScore: number): Outcome {
  const cmp = (x: number): Outcome => (x > 0 ? 'won' : x < 0 ? 'lost' : 'push');
  switch (pick.market) {
    case 'moneyline': {
      const margin = homeScore - awayScore;
      return cmp(pick.selection === 'home' ? margin : -margin);
    }
    case 'spread': {
      const point = pick.point ?? 0;
      const margin = pick.selection === 'home' ? homeScore + point - awayScore : awayScore + point - homeScore;
      return cmp(margin);
    }
    case 'total': {
      const diff = homeScore + awayScore - (pick.point ?? 0);
      return cmp(pick.selection === 'over' ? diff : -diff);
    }
    default:
      throw new Error(`Unknown market ${pick.market}`);
  }
}

interface PendingPick {
  id: string;
  user_id: string;
  market: string;
  selection: string;
  point: number | null;
  price: number;
  stake: number;
  commence_time: number;
}

function settle(db: DB, p: PendingPick, status: 'won' | 'lost' | 'push' | 'void', now: number): void {
  let payout = 0;
  if (status === 'won') {
    payout = winPayout(p.stake, p.price);
    postLedger(db, { userId: p.user_id, kind: 'pick_won', amount: payout, scoreDelta: payout - p.stake, ref: p.id, at: now, scoreAt: p.commence_time });
  } else if (status === 'push' || status === 'void') {
    payout = p.stake;
    postLedger(db, { userId: p.user_id, kind: status === 'push' ? 'pick_push' : 'pick_void', amount: p.stake, scoreDelta: 0, ref: p.id, at: now, scoreAt: p.commence_time });
  } else {
    // The stake already left the balance when the pick was made; only the leaderboard changes.
    postLedger(db, { userId: p.user_id, kind: 'pick_lost', amount: 0, scoreDelta: -p.stake, ref: p.id, at: now, scoreAt: p.commence_time });
  }
  db.prepare("UPDATE picks SET status = ?, payout = ?, settled_at = ? WHERE id = ? AND status = 'pending'").run(
    status,
    payout,
    now,
    p.id,
  );
}

/** Settle every pending pick on a completed event. Returns how many were settled. */
export function gradeEvent(db: DB, eventId: string, now: number): number {
  return tx(db, () => {
    const ev = db.prepare('SELECT completed, home_score, away_score FROM events WHERE id = ?').get(eventId) as
      | { completed: number; home_score: number | null; away_score: number | null }
      | undefined;
    if (!ev || !ev.completed || ev.home_score === null || ev.away_score === null) return 0;
    const picks = db
      .prepare("SELECT p.id, p.user_id, p.market, p.selection, p.point, p.price, p.stake, e.commence_time FROM picks p JOIN events e ON e.id = p.event_id WHERE p.event_id = ? AND p.status = 'pending'")
      .all(eventId) as unknown as PendingPick[];
    for (const p of picks) settle(db, p, gradePick(p, ev.home_score, ev.away_score), now);
    return picks.length;
  });
}

/**
 * The scores endpoint only looks back 3 days. A game that still has no final
 * score by then was most likely postponed or cancelled, so refund its picks.
 */
export const VOID_AFTER_MS = 3 * DAY;

export function voidStalePicks(db: DB, now: number): number {
  return tx(db, () => {
    const picks = db
      .prepare(
        `SELECT p.id, p.user_id, p.market, p.selection, p.point, p.price, p.stake, e.commence_time
         FROM picks p JOIN events e ON e.id = p.event_id
         WHERE p.status = 'pending' AND e.completed = 0 AND e.commence_time < ?`,
      )
      .all(now - VOID_AFTER_MS) as unknown as PendingPick[];
    for (const p of picks) settle(db, p, 'void', now);
    return picks.length;
  });
}
