// Rewarded video ads.
//
// Every ad view has a purpose, chosen when the app starts the session:
//  - points:  grants AD_REWARD_POINTS points, only while the player is out of
//             points (balance below the minimum pick and no picks still in
//             play), at most POINTS_ADS_PER_DAY times a day. New players start
//             at 0, so their first points come from this too and count.
//  - pick:    grants no points. A completed pick ad unlocks exactly one pick.
//  - forfeit: grants no points. Lets the player give up one pending pick as a
//             loss, so they can get back to 0 and earn points sooner.
// There is no way to watch ads for points at will.
//
// Flow:
//  1. App calls POST /ads/sessions {purpose} and gets a one-time session id.
//  2. App shows a rewarded ad, passing the session id as the ad's server-side
//     verification "custom data".
//  3. The ad network calls our SSV callback once the video is finished; we
//     verify its signature and complete the session.
//  4. App polls GET /ads/sessions/:id until it is complete.
// In development (AD_PROVIDER=stub) the app completes the session itself.
//
// Rewards are a fixed number of points. They are not tied to what the ad paid
// us, and prizes are not tied to ad revenue either.

import { createVerify, randomUUID } from 'node:crypto';
import { AD_REWARD_POINTS, type Config } from './config.ts';
import { tx, type DB } from './db.ts';
import { postLedger } from './points.ts';
import { sportsDay } from './time.ts';

export const AD_PURPOSES = ['points', 'pick', 'forfeit'] as const;
export type AdPurpose = (typeof AD_PURPOSES)[number];

/** How long after finishing a pick or forfeit ad the player has to confirm. */
export const PICK_AD_WINDOW_MS = 30 * 60 * 1000;
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

export interface AdEligibility {
  pointsAdsToday: number;
  pointsAdsPerDay: number;
  /** Out of points (below the minimum pick, nothing in play) and still has points ads left today. */
  canEarnPoints: boolean;
  balance: number;
  pendingPicks: number;
}

type Refusal = 'not_out_of_points' | 'points_in_play' | 'daily_limit';

export function adEligibility(db: DB, cfg: Config, userId: string, now: number): AdEligibility {
  const day = sportsDay(now, cfg.timeZone, cfg.dayStartHour);
  const used = db
    .prepare("SELECT COUNT(*) AS n FROM ad_sessions WHERE user_id = ? AND purpose = 'points' AND rewarded_at >= ? AND rewarded_at < ?")
    .get(userId, day.start, day.end) as { n: number };
  const balance = (db.prepare('SELECT balance FROM users WHERE id = ?').get(userId) as { balance: number } | undefined)?.balance ?? 0;
  const pending = db.prepare("SELECT COUNT(*) AS n FROM picks WHERE user_id = ? AND status = 'pending'").get(userId) as { n: number };
  return {
    pointsAdsToday: used.n,
    pointsAdsPerDay: cfg.pointsAdsPerDay,
    canEarnPoints: balance < cfg.minPickPoints && pending.n === 0 && used.n < cfg.pointsAdsPerDay,
    balance,
    pendingPicks: pending.n,
  };
}

function refusal(e: AdEligibility, cfg: Config): Refusal | null {
  if (e.balance >= cfg.minPickPoints) return 'not_out_of_points';
  if (e.pendingPicks > 0) return 'points_in_play';
  if (e.pointsAdsToday >= e.pointsAdsPerDay) return 'daily_limit';
  return null;
}

export type StartResult = { ok: true; sessionId: string } | { ok: false; reason: Refusal };

export function createAdSession(db: DB, cfg: Config, userId: string, purpose: AdPurpose, now: number): StartResult {
  if (purpose === 'points') {
    const why = refusal(adEligibility(db, cfg, userId, now), cfg);
    if (why) return { ok: false, reason: why };
  }
  const id = randomUUID();
  db.prepare('INSERT INTO ad_sessions (id, user_id, purpose, created_at) VALUES (?, ?, ?, ?)').run(id, userId, purpose, now);
  return { ok: true, sessionId: id };
}

export type GrantResult =
  | { ok: true; balance: number; userId: string; purpose: AdPurpose }
  | {
      ok: false;
      reason: 'unknown_session' | 'already_rewarded' | 'expired' | 'duplicate_transaction' | Refusal;
    };

/** Complete an ad session once the ad network (or the stub) confirms the video was watched. */
export function grantAdReward(db: DB, cfg: Config, sessionId: string, transactionId: string, now: number): GrantResult {
  return tx(db, (): GrantResult => {
    const s = db.prepare('SELECT user_id, purpose, created_at, rewarded_at FROM ad_sessions WHERE id = ?').get(sessionId) as
      | { user_id: string; purpose: AdPurpose; created_at: number; rewarded_at: number | null }
      | undefined;
    if (!s) return { ok: false, reason: 'unknown_session' };
    if (s.rewarded_at !== null) return { ok: false, reason: 'already_rewarded' };
    if (now - s.created_at > SESSION_TTL_MS) return { ok: false, reason: 'expired' };
    const dup = db.prepare('SELECT 1 FROM ad_sessions WHERE transaction_id = ?').get(transactionId);
    if (dup) return { ok: false, reason: 'duplicate_transaction' };

    // Re-check at reward time: the player may have started two sessions at once.
    if (s.purpose === 'points') {
      const why = refusal(adEligibility(db, cfg, s.user_id, now), cfg);
      if (why) return { ok: false, reason: why };
    }

    db.prepare('UPDATE ad_sessions SET rewarded_at = ?, transaction_id = ? WHERE id = ?').run(now, transactionId, sessionId);
    let balance: number;
    if (s.purpose !== 'points') {
      balance = (db.prepare('SELECT balance FROM users WHERE id = ?').get(s.user_id) as { balance: number }).balance;
    } else {
      balance = postLedger(db, {
        userId: s.user_id,
        kind: 'ad_reward',
        amount: AD_REWARD_POINTS,
        scoreDelta: AD_REWARD_POINTS,
        ref: sessionId,
        at: now,
      });
    }
    return { ok: true, balance, userId: s.user_id, purpose: s.purpose };
  });
}

/**
 * Must run inside the pick or forfeit transaction. Uses up one completed ad of
 * the given purpose, finished within the last 30 minutes. Returns false if there is none.
 */
export function consumeAd(db: DB, userId: string, sessionId: string | undefined, purpose: 'pick' | 'forfeit', usedFor: string, now: number): boolean {
  if (!sessionId) return false;
  const res = db
    .prepare(
      `UPDATE ad_sessions SET used_at = ?, used_for = ?
       WHERE id = ? AND user_id = ? AND purpose = ? AND rewarded_at IS NOT NULL AND rewarded_at >= ? AND used_at IS NULL`,
    )
    .run(now, usedFor, sessionId, userId, purpose, now - PICK_AD_WINDOW_MS);
  return res.changes === 1;
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
