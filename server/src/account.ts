// Deleting an account from inside the app (the App Store requires this for
// apps with sign-in). Everything about the player is removed: contact details,
// sign-in link, push token, picks, points, contest entries, messages and any
// unpaid prize claim. The one exception is a prize that was already paid: that
// claim is kept for tax records, so the user row stays behind with every
// personal field cleared and an anonymous name.

import { randomBytes } from 'node:crypto';
import { tx, type DB } from './db.ts';

export function deleteAccount(db: DB, userId: string): { kept: 'nothing' | 'paid_prize_records' } {
  return tx(db, () => {
    for (const t of ['picks', 'ledger', 'ad_sessions', 'competition_entries', 'contact_messages']) {
      db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(userId);
    }
    db.prepare("DELETE FROM prize_claims WHERE user_id = ? AND status != 'paid'").run(userId);
    const paid = db.prepare('SELECT 1 FROM prize_claims WHERE user_id = ? LIMIT 1').get(userId);
    if (!paid) {
      db.prepare('UPDATE competitions SET winner_user_id = NULL WHERE winner_user_id = ?').run(userId);
      db.prepare('DELETE FROM users WHERE id = ?').run(userId);
      return { kept: 'nothing' as const };
    }
    db.prepare(
      `UPDATE users SET display_name = ?, token_hash = ?, auth_provider = NULL, auth_sub = NULL, email = NULL, email_key = NULL,
         phone = NULL, country = NULL, region = NULL, birth_date = NULL, push_token = NULL, phone_verified_at = NULL WHERE id = ?`,
    ).run(`deleted_${randomBytes(4).toString('hex')}`, `deleted-${randomBytes(16).toString('hex')}`, userId);
    return { kept: 'paid_prize_records' as const };
  });
}
