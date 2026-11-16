// Rewarded video ads -> points.
//
// Flow:
//  1. App calls POST /ads/sessions and gets a one-time session id.
//  2. App shows a rewarded ad, passing the session id as the ad's server-side
//     verification "custom data".
//  3. The ad network calls our SSV callback once the video is finished; we
//     verify its signature and grant exactly AD_REWARD_POINTS.
//  4. App polls GET /ads/sessions/:id to show the new balance.
// In development (AD_PROVIDER=stub) the app completes the session itself.
//
// The reward is a fixed number of points per completed view. It is not tied to
// what the ad paid us, and prizes are not tied to ad revenue either.

import { createVerify, randomUUID } from 'node:crypto';
import { AD_REWARD_POINTS, type Config } from './config.ts';
import { tx, type DB } from './db.ts';
import { postLedger } from './points.ts';
import { sportsDay } from './time.ts';

export function createAdSession(db: DB, userId: string, now: number): string {
  const id = randomUUID();
  db.prepare('INSERT INTO ad_sessions (id, user_id, created_at) VALUES (?, ?, ?)').run(id, userId, now);
  return id;
}

export function adsWatchedToday(db: DB, cfg: Config, userId: string, now: number): number {
  const day = sportsDay(now, cfg.timeZone, cfg.dayStartHour);
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM ad_sessions WHERE user_id = ? AND rewarded_at >= ? AND rewarded_at < ?')
    .get(userId, day.start, day.end) as { n: number };
  return row.n;
}

export type GrantResult =
  | { ok: true; balance: number; userId: string }
  | { ok: false; reason: 'unknown_session' | 'already_rewarded' | 'daily_cap' | 'expired' | 'duplicate_transaction' };

const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

export function grantAdReward(db: DB, cfg: Config, sessionId: string, transactionId: string, now: number): GrantResult {
  return tx(db, () => {
    const s = db.prepare('SELECT user_id, created_at, rewarded_at FROM ad_sessions WHERE id = ?').get(sessionId) as
      | { user_id: string; created_at: number; rewarded_at: number | null }
      | undefined;
    if (!s) return { ok: false, reason: 'unknown_session' } as const;
    if (s.rewarded_at !== null) return { ok: false, reason: 'already_rewarded' } as const;
    if (now - s.created_at > SESSION_TTL_MS) return { ok: false, reason: 'expired' } as const;
    const dup = db.prepare('SELECT 1 FROM ad_sessions WHERE transaction_id = ?').get(transactionId);
    if (dup) return { ok: false, reason: 'duplicate_transaction' } as const;
    if (adsWatchedToday(db, cfg, s.user_id, now) >= cfg.adDailyCap) return { ok: false, reason: 'daily_cap' } as const;

    db.prepare('UPDATE ad_sessions SET rewarded_at = ?, transaction_id = ? WHERE id = ?').run(now, transactionId, sessionId);
    const balance = postLedger(db, {
      userId: s.user_id,
      kind: 'ad_reward',
      amount: AD_REWARD_POINTS,
      scoreDelta: AD_REWARD_POINTS,
      ref: sessionId,
      at: now,
    });
    return { ok: true, balance, userId: s.user_id } as const;
  });
}

// ---- AdMob server-side verification ----------------------------------------
// https://developers.google.com/admob/android/ssv

const ADMOB_KEYS_URL = 'https://www.gstatic.com/admob/reward/verifier-keys.json';
interface AdmobKey {
  keyId: number;
  pem: string;
}
let keyCache: { keys: AdmobKey[]; at: number } | null = null;

export async function fetchAdmobKeys(fetchImpl: typeof fetch = fetch): Promise<AdmobKey[]> {
  if (keyCache && Date.now() - keyCache.at < 24 * 60 * 60 * 1000) return keyCache.keys;
  const res = await fetchImpl(ADMOB_KEYS_URL);
  if (!res.ok) throw new Error(`Could not fetch AdMob verifier keys: ${res.status}`);
  const body = (await res.json()) as { keys: AdmobKey[] };
  keyCache = { keys: body.keys, at: Date.now() };
  return body.keys;
}

/**
 * Verify an AdMob SSV callback. `rawQuery` is the query string exactly as received
 * (without the leading "?"). Returns the parsed params if the signature is valid.
 */
export function verifyAdmobSsv(rawQuery: string, keys: AdmobKey[]): URLSearchParams | null {
  const sigAt = rawQuery.indexOf('&signature=');
  if (sigAt < 0) return null;
  const message = rawQuery.slice(0, sigAt);
  const params = new URLSearchParams(rawQuery);
  const signature = params.get('signature');
  const keyId = params.get('key_id');
  if (!signature || !keyId) return null;
  const key = keys.find((k) => String(k.keyId) === keyId);
  if (!key) return null;
  const verifier = createVerify('sha256');
  verifier.update(message);
  const ok = verifier.verify(key.pem, Buffer.from(signature, 'base64url'));
  return ok ? params : null;
}
