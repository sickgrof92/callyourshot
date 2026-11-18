// Grades pending picks once a game's final score is in.

import { tx, type DB } from './db.ts';
import { payoutMultiplier, postLedger, winPayout } from './points.ts';
import { DAY, HOUR } from './time.ts';

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
  competition_id: string;
  market: string;
  selection: string;
  point: number | null;
  price: number;
  stake: number;
  commence_time: number;
}

function settle(db: DB, p: PendingPick, status: 'won' | 'lost' | 'push' | 'void', now: number, winAmount?: number): void {
  const base = { userId: p.user_id, competitionId: p.competition_id, ref: p.id, at: now };
  let payout = 0;
  if (status === 'won') {
    payout = winAmount ?? winPayout(p.stake, p.price);
    postLedger(db, { ...base, kind: 'pick_won', amount: payout });
  } else if (status === 'push' || status === 'void') {
    payout = p.stake;
    postLedger(db, { ...base, kind: status === 'push' ? 'pick_push' : 'pick_void', amount: p.stake });
  } else {
    // The stake already left the balance when the pick was made; record the result.
    postLedger(db, { ...base, kind: 'pick_lost', amount: 0 });
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
      .prepare("SELECT p.id, p.user_id, p.competition_id, p.market, p.selection, p.point, p.price, p.stake, e.commence_time FROM picks p JOIN events e ON e.id = p.event_id WHERE p.event_id = ? AND p.status = 'pending'")
      .all(eventId) as unknown as PendingPick[];
    for (const p of picks) settle(db, p, gradePick(p, ev.home_score, ev.away_score), now);
    const h = ev.home_score;
    const a = ev.away_score;
    return picks.length + settleLegs(db, eventId, (leg) => gradePick(leg, h, a), now);
  });
}

// ---- Parlays -----------------------------------------------------------------
// A parlay wins only if every game wins. A pushed or refunded game drops out
// and the parlay pays on the games left (all of them dropping out refunds it).
// One losing game loses the parlay right away.

/** Points returned on a winning parlay: stake times every winning game's multiplier, rounded down. */
export function parlayPayout(stake: number, prices: number[]): number {
  const m = prices.reduce((acc, p) => acc * payoutMultiplier(p), 1);
  return Math.floor(stake * m + 1e-9);
}

/** Grade (or refund) the parlay games on one event, then settle the parlays that are now decided. Returns parlays settled. */
function settleLegs(db: DB, eventId: string, outcome: (leg: GradablePick) => Outcome | 'void', now: number): number {
  const legs = db.prepare("SELECT pick_id, market, selection, point FROM parlay_legs WHERE event_id = ? AND status = 'pending'").all(eventId) as unknown as (GradablePick & {
    pick_id: string;
  })[];
  const setLeg = db.prepare('UPDATE parlay_legs SET status = ? WHERE pick_id = ? AND event_id = ?');
  for (const l of legs) setLeg.run(outcome(l), l.pick_id, eventId);
  let n = 0;
  for (const id of new Set(legs.map((l) => l.pick_id))) if (settleParlay(db, id, now)) n++;
  return n;
}

/** Settle one parlay if its result is known. Returns true if it was settled now. */
export function settleParlay(db: DB, pickId: string, now: number): boolean {
  const p = db
    .prepare("SELECT id, user_id, competition_id, market, selection, point, price, stake, 0 AS commence_time FROM picks WHERE id = ? AND status = 'pending' AND market = 'parlay'")
    .get(pickId) as PendingPick | undefined;
  if (!p) return false;
  const legs = db.prepare('SELECT status, price FROM parlay_legs WHERE pick_id = ?').all(pickId) as { status: string; price: number }[];
  if (legs.some((l) => l.status === 'lost')) {
    settle(db, p, 'lost', now);
    return true;
  }
  if (legs.some((l) => l.status === 'pending')) return false;
  const won = legs.filter((l) => l.status === 'won');
  if (won.length === 0) settle(db, p, legs.some((l) => l.status === 'push') ? 'push' : 'void', now);
  else settle(db, p, 'won', now, parlayPayout(p.stake, won.map((l) => l.price)));
  return true;
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
        `SELECT p.id, p.user_id, p.competition_id, p.market, p.selection, p.point, p.price, p.stake, e.commence_time
         FROM picks p JOIN events e ON e.id = p.event_id
         WHERE p.status = 'pending' AND e.completed = 0 AND e.commence_time < ?`,
      )
      .all(now - VOID_AFTER_MS) as unknown as PendingPick[];
    for (const p of picks) settle(db, p, 'void', now);
    const staleLegs = db
      .prepare(
        `SELECT DISTINCT l.event_id AS id FROM parlay_legs l JOIN events e ON e.id = l.event_id
         WHERE l.status = 'pending' AND e.completed = 0 AND e.commence_time < ?`,
      )
      .all(now - VOID_AFTER_MS) as { id: string }[];
    let n = picks.length;
    for (const { id } of staleLegs) n += settleLegs(db, id, () => 'void', now);
    return n;
  });
}

/** A start time moving by this much or more means the game was postponed (or moved), not just tweaked. */
export const RESCHEDULE_MS = 2 * HOUR;

/**
 * Refund picks as soon as the schedule shows a game was postponed or cancelled,
 * instead of waiting for VOID_AFTER_MS. Call with a sport's fresh schedule
 * (the free events listing) *before* saving it:
 *  - a game whose start time moved by RESCHEDULE_MS or more was postponed:
 *    its pending picks are refunded (the game stays listed at its new time);
 *  - a game that hasn't started yet and is gone from the schedule was
 *    cancelled: its pending picks are refunded and it is hidden from Games.
 * Returns how many picks were refunded.
 */
export function voidPostponed(db: DB, sport: string, feed: { id: string; commence_time: string }[], now: number): number {
  return tx(db, () => {
    const known = db.prepare('SELECT id, commence_time FROM events WHERE sport = ? AND completed = 0 AND cancelled = 0').all(sport) as {
      id: string;
      commence_time: number;
    }[];
    const inFeed = new Map(feed.map((e) => [e.id, Date.parse(e.commence_time)]));
    const pendingStmt = db.prepare(
      `SELECT p.id, p.user_id, p.competition_id, p.market, p.selection, p.point, p.price, p.stake, e.commence_time
       FROM picks p JOIN events e ON e.id = p.event_id WHERE p.event_id = ? AND p.status = 'pending'`,
    );
    let n = 0;
    for (const ev of known) {
      const newStart = inFeed.get(ev.id);
      let off = false;
      if (newStart === undefined) {
        // An empty schedule is more likely a glitch than every game being cancelled.
        if (feed.length === 0 || ev.commence_time <= now) continue;
        db.prepare('UPDATE events SET cancelled = 1, updated_at = ? WHERE id = ?').run(now, ev.id);
        off = true;
      } else if (Number.isFinite(newStart) && Math.abs(newStart - ev.commence_time) >= RESCHEDULE_MS) {
        off = true;
      }
      if (!off) continue;
      const picks = pendingStmt.all(ev.id) as unknown as PendingPick[];
      for (const p of picks) settle(db, p, 'void', now);
      n += picks.length + settleLegs(db, ev.id, () => 'void', now);
    }
    return n;
  });
}
