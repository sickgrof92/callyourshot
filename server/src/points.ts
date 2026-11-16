// The points ledger. Points live inside a contest: each entry starts at 0 and
// can only grow by watching rewarded ads or winning picks in that contest.
// Points have no cash value and are only spent on picks.
// There is intentionally no purchase, transfer, gift or cash-out path.

import type { DB, LedgerKind } from './db.ts';

/**
 * Change a player's balance in one contest. Must be called inside a
 * transaction. Throws if the balance would go negative or they haven't joined.
 */
export function postLedger(
  db: DB,
  entry: { userId: string; competitionId: string; kind: LedgerKind; amount: number; ref: string | null; at: number },
): number {
  const res = db
    .prepare('UPDATE competition_entries SET balance = balance + ? WHERE competition_id = ? AND user_id = ? AND balance + ? >= 0')
    .run(entry.amount, entry.competitionId, entry.userId, entry.amount);
  if (res.changes !== 1) throw new InsufficientPointsError();
  db.prepare('INSERT INTO ledger (user_id, competition_id, kind, amount, ref, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    entry.userId,
    entry.competitionId,
    entry.kind,
    entry.amount,
    entry.ref,
    entry.at,
  );
  return entryBalance(db, entry.competitionId, entry.userId);
}

export function entryBalance(db: DB, competitionId: string, userId: string): number {
  const row = db.prepare('SELECT balance FROM competition_entries WHERE competition_id = ? AND user_id = ?').get(competitionId, userId) as
    | { balance: number }
    | undefined;
  return row?.balance ?? 0;
}

export class InsufficientPointsError extends Error {
  constructor() {
    super('Not enough points');
  }
}

/** American price to a payout multiplier, e.g. -110 -> 1.909, +150 -> 2.5. */
export function payoutMultiplier(price: number): number {
  return price > 0 ? 1 + price / 100 : 1 + 100 / Math.abs(price);
}

/** Points returned on a winning pick (stake included). Rounded down. */
export function winPayout(stake: number, price: number): number {
  // Integer math so 10 points at +130 pays exactly 23, not 22.
  const profit = price > 0 ? Math.floor((stake * price) / 100) : Math.floor((stake * 100) / Math.abs(price));
  return stake + profit;
}
