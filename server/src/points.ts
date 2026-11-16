// The points ledger. Points have no cash value: they can only be earned by
// watching rewarded ads or winning picks, and only spent on picks.
// There is intentionally no purchase, transfer, gift or cash-out path.

import type { DB, LedgerKind } from './db.ts';

/** Must be called inside a transaction. Throws if the balance would go negative. */
export function postLedger(
  db: DB,
  entry: { userId: string; kind: LedgerKind; amount: number; scoreDelta: number; ref: string | null; at: number; scoreAt?: number },
): number {
  const res = db
    .prepare('UPDATE users SET balance = balance + ? WHERE id = ? AND balance + ? >= 0')
    .run(entry.amount, entry.userId, entry.amount);
  if (res.changes !== 1) throw new InsufficientPointsError();
  db.prepare('INSERT INTO ledger (user_id, kind, amount, score_delta, ref, created_at, score_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(entry.userId, entry.kind, entry.amount, entry.scoreDelta, entry.ref, entry.at, entry.scoreAt ?? entry.at);
  const row = db.prepare('SELECT balance FROM users WHERE id = ?').get(entry.userId) as { balance: number };
  return row.balance;
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
