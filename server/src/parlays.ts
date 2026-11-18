// Parlays and round robins.
//
// A parlay is 2 to 10 picks on different games, all made with one amount of
// points. It wins only if every game wins, and pays the product of the
// games' multipliers. A pushed or refunded game drops out and the parlay pays
// on the rest (see grading.ts).
//
// A round robin is a set of parlays built from 3 to 8 picks: for example "by
// 2s" from 3 picks makes 3 two-game parlays. Each one is its own parlay (its
// own picks row) with the same amount of points, tied together by group_id.
// The player pays for all of them up front.
//
// Both take one ad, like a single pick, and lock when their first game starts.

import { randomUUID } from 'node:crypto';
import { consumeAd } from './ads.ts';
import type { Config } from './config.ts';
import { tx, type DB } from './db.ts';
import { expectedEnd } from './gameLength.ts';
import type { LineRow, MarketKind, Selection } from './lines.ts';
import { entryBalance, payoutMultiplier, postLedger } from './points.ts';

export const PARLAY_MIN_LEGS = 2;
export const PARLAY_MAX_LEGS = 10;
export const ROUND_ROBIN_MIN_PICKS = 3;
export const ROUND_ROBIN_MAX_PICKS = 8;

const VALID: Record<MarketKind, Selection[]> = {
  moneyline: ['home', 'away'],
  spread: ['home', 'away'],
  total: ['over', 'under'],
};

export interface LegInput {
  eventId: string;
  market: MarketKind;
  selection: Selection;
  /** The line the player saw. If it has moved since, nothing is placed and the new line is returned. */
  expectedPoint?: number | null;
  expectedPrice?: number;
}

export interface ParlayInput {
  competitionId: string;
  legs: LegInput[];
  /** Missing or empty: one parlay with every leg. Otherwise a round robin of parlays of these sizes, e.g. [2] for "by 2s". */
  sizes?: number[];
  /** Points on each parlay. A round robin costs this times the number of parlays. */
  points: number;
  adSessionId?: string;
}

export type ParlayError =
  | 'not_joined'
  | 'contest_not_live'
  | 'bad_legs'
  | 'same_game'
  | 'bad_sizes'
  | 'bad_amount'
  | 'not_found'
  | 'locked'
  | 'after_contest_end'
  | 'wrong_sport'
  | 'no_line'
  | 'not_enough_points'
  | 'pick_ad_required';

export type ParlayResult =
  | { ok: true; groupId: string; pickIds: string[]; totalPoints: number; balance: number }
  | { ok: false; error: ParlayError; eventId?: string }
  | { ok: false; error: 'line_moved'; eventId: string; line: LineRow };

/** Every way to choose `k` of `items`, in order. */
export function combinations<T>(items: T[], k: number): T[][] {
  const out: T[][] = [];
  const pick = (start: number, acc: T[]) => {
    if (acc.length === k) {
      out.push(acc);
      return;
    }
    for (let i = start; i <= items.length - (k - acc.length); i++) pick(i + 1, [...acc, items[i]!]);
  };
  pick(0, []);
  return out;
}

/** A parlay's combined line as an American price, for display (payouts use each game's own line). */
export function combinedPrice(prices: number[]): number {
  const m = prices.reduce((acc, p) => acc * payoutMultiplier(p), 1);
  return m >= 2 ? Math.round((m - 1) * 100) : -Math.round(100 / (m - 1));
}

export function placeParlay(db: DB, cfg: Config, userId: string, input: ParlayInput, now: number): ParlayResult {
  const legs = input.legs;
  const roundRobin = !!input.sizes?.length;
  if (roundRobin) {
    if (legs.length < ROUND_ROBIN_MIN_PICKS || legs.length > ROUND_ROBIN_MAX_PICKS) return { ok: false, error: 'bad_legs' };
    const sizes = input.sizes!;
    if (new Set(sizes).size !== sizes.length || sizes.some((k) => !Number.isInteger(k) || k < 2 || k >= legs.length)) return { ok: false, error: 'bad_sizes' };
  } else if (legs.length < PARLAY_MIN_LEGS || legs.length > PARLAY_MAX_LEGS) {
    return { ok: false, error: 'bad_legs' };
  }
  if (legs.some((l) => !VALID[l.market]?.includes(l.selection))) return { ok: false, error: 'no_line' };
  if (new Set(legs.map((l) => l.eventId)).size !== legs.length) return { ok: false, error: 'same_game' };
  if (!Number.isInteger(input.points) || input.points < cfg.minPickPoints || input.points > cfg.maxPickPoints) return { ok: false, error: 'bad_amount' };

  return tx(db, (): ParlayResult => {
    const c = db.prepare('SELECT starts_at, ends_at, sport FROM competitions WHERE id = ?').get(input.competitionId) as
      | { starts_at: number; ends_at: number; sport: string | null }
      | undefined;
    if (!c || !db.prepare('SELECT 1 FROM competition_entries WHERE competition_id = ? AND user_id = ?').get(input.competitionId, userId)) {
      return { ok: false, error: 'not_joined' };
    }
    if (now < c.starts_at || now >= c.ends_at) return { ok: false, error: 'contest_not_live' };

    // Check every game and line first; nothing is saved unless all of them pass.
    const priced: (LegInput & { point: number | null; price: number })[] = [];
    for (const leg of legs) {
      const ev = db.prepare('SELECT commence_time, sport FROM events WHERE id = ? AND cancelled = 0').get(leg.eventId) as
        | { commence_time: number; sport: string }
        | undefined;
      if (!ev) return { ok: false, error: 'not_found', eventId: leg.eventId };
      if (now >= ev.commence_time) return { ok: false, error: 'locked', eventId: leg.eventId };
      if (expectedEnd(ev.sport, ev.commence_time) > c.ends_at) return { ok: false, error: 'after_contest_end', eventId: leg.eventId };
      if (c.sport && ev.sport !== c.sport) return { ok: false, error: 'wrong_sport', eventId: leg.eventId };
      const line = db
        .prepare('SELECT * FROM lines WHERE event_id = ? AND market = ? AND selection = ?')
        .get(leg.eventId, leg.market, leg.selection) as LineRow | undefined;
      if (!line) return { ok: false, error: 'no_line', eventId: leg.eventId };
      if ((leg.expectedPrice !== undefined && leg.expectedPrice !== line.price) || (leg.expectedPoint !== undefined && leg.expectedPoint !== line.point)) {
        return { ok: false, error: 'line_moved', eventId: leg.eventId, line };
      }
      priced.push({ ...leg, point: line.point, price: line.price });
    }

    const sets = roundRobin ? input.sizes!.flatMap((k) => combinations(priced, k)) : [priced];
    const totalPoints = input.points * sets.length;
    if (totalPoints > entryBalance(db, input.competitionId, userId)) return { ok: false, error: 'not_enough_points' };
    const groupId = randomUUID();
    if (!consumeAd(db, userId, input.adSessionId, 'pick', groupId, now)) return { ok: false, error: 'pick_ad_required' };

    const insertPick = db.prepare(
      `INSERT INTO picks (id, user_id, competition_id, event_id, market, selection, point, price, stake, created_at, group_id)
       VALUES (?, ?, ?, NULL, 'parlay', ?, NULL, ?, ?, ?, ?)`,
    );
    const insertLeg = db.prepare('INSERT INTO parlay_legs (pick_id, event_id, market, selection, point, price) VALUES (?, ?, ?, ?, ?, ?)');
    const pickIds: string[] = [];
    let balance = entryBalance(db, input.competitionId, userId);
    for (const set of sets) {
      const id = randomUUID();
      insertPick.run(id, userId, input.competitionId, roundRobin ? 'round_robin' : 'parlay', combinedPrice(set.map((l) => l.price)), input.points, now, groupId);
      for (const l of set) insertLeg.run(id, l.eventId, l.market, l.selection, l.point, l.price);
      balance = postLedger(db, { userId, competitionId: input.competitionId, kind: 'pick_stake', amount: -input.points, ref: id, at: now });
      pickIds.push(id);
    }
    return { ok: true, groupId, pickIds, totalPoints, balance };
  });
}
