// Rewarded video ads.
//
// Every ad view has a purpose, chosen when the app starts the session:
//  - points:  grants AD_REWARD_POINTS points in one contest, only while the
//             player is out of points there (balance below the minimum pick
//             and no picks still in play in that contest), at most
//             POINTS_ADS_PER_DAY times a day per contest. Everyone starts a
//             contest at 0, so their first points come from this too and count.
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
import { entryBalance, postLedger } from './points.ts';
import { sportsDay } from './time.ts';

export const AD_PURPOSES = ['points', 'pick', 'forfeit'] as const;
export type AdPurpose = (typeof AD_PURPOSES)[number];

/** How long after finishing a pick or forfeit ad the player has to confirm. */
export const PICK_AD_WINDOW_MS = 30 * 60 * 1000;
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

export interface AdEligibility {
  pointsAdsToday: number;
  pointsAdsPerDay: number;
  /** Out of points in this contest (below the minimum pick, nothing in play) with refills left today. */
  canEarnPoints: boolean;
  balance: number;
  pendingPicks: number;
  joined: boolean;
  live: boolean;
}

type Refusal = 'not_joined' | 'contest_not_live' | 'not_out_of_points' | 'points_in_play' | 'daily_limit';

/** A player's standing for points videos in one contest. */
export function adEligibility(db: DB, cfg: Config, userId: string, competitionId: string, now: number): AdEligibility {
  const day = sportsDay(now, cfg.timeZone, cfg.dayStartHour);
  const c = db.prepare('SELECT starts_at, ends_at FROM competitions WHERE id = ?').get(competitionId) as { starts_at: number; ends_at: number } | undefined;
  const joined = !!db.prepare('SELECT 1 FROM competition_entries WHERE competition_id = ? AND user_id = ?').get(competitionId, userId);
  const live = !!c && now >= c.starts_at && now < c.ends_at;
  const used = db
    .prepare(
      "SELECT COUNT(*) AS n FROM ad_sessions WHERE user_id = ? AND competition_id = ? AND purpose = 'points' AND rewarded_at >= ? AND rewarded_at < ?",
    )
    .get(userId, competitionId, day.start, day.end) as { n: number };
  const balance = entryBalance(db, competitionId, userId);
  const pending = db
    .prepare("SELECT COUNT(*) AS n FROM picks WHERE user_id = ? AND competition_id = ? AND status = 'pending'")
    .get(userId, competitionId) as { n: number };
  return {
    pointsAdsToday: used.n,
    pointsAdsPerDay: cfg.pointsAdsPerDay,
    canEarnPoints: joined && live && balance < cfg.minPickPoints && pending.n === 0 && used.n < cfg.pointsAdsPerDay,
    balance,
    pendingPicks: pending.n,
    joined,
    live,
  };
}

function refusal(e: AdEligibility, cfg: Config): Refusal | null {
  if (!e.joined) return 'not_joined';
  if (!e.live) return 'contest_not_live';
  if (e.balance >= cfg.minPickPoints) return 'not_out_of_points';
  if (e.pendingPicks > 0) return 'points_in_play';
  if (e.pointsAdsToday >= e.pointsAdsPerDay) return 'daily_limit';
  return null;
}

export type StartResult = { ok: true; sessionId: string } | { ok: false; reason: Refusal | 'contest_required' };

export function createAdSession(db: DB, cfg: Config, userId: string, purpose: AdPurpose, now: number, competitionId?: string): StartResult {
  if (purpose === 'points') {
    if (!competitionId) return { ok: false, reason: 'contest_required' };
    const why = refusal(adEligibility(db, cfg, userId, competitionId, now), cfg);
    if (why) return { ok: false, reason: why };
  }
  const id = randomUUID();
  db.prepare('INSERT INTO ad_sessions (id, user_id, purpose, competition_id, created_at) VALUES (?, ?, ?, ?, ?)').run(
    id,
    userId,
    purpose,
    purpose === 'points' ? competitionId! : null,
    now,
  );
  return { ok: true, sessionId: id };
}

export type GrantResult =
  | { ok: true; balance: number; userId: string; purpose: AdPurpose; competitionId: string | null }
  | {
      ok: false;
      reason: 'unknown_session' | 'already_rewarded' | 'expired' | 'duplicate_transaction' | Refusal;
    };

/** Complete an ad session once the ad network (or the stub) confirms the video was watched. */
export function grantAdReward(db: DB, cfg: Config, sessionId: string, transactionId: string, now: number): GrantResult {
  return tx(db, (): GrantResult => {
    const s = db.prepare('SELECT user_id, purpose, competition_id, created_at, rewarded_at FROM ad_sessions WHERE id = ?').get(sessionId) as
      | { user_id: string; purpose: AdPurpose; competition_id: string | null; created_at: number; rewarded_at: number | null }
      | undefined;
    if (!s) return { ok: false, reason: 'unknown_session' };
    if (s.rewarded_at !== null) return { ok: false, reason: 'already_rewarded' };
    if (now - s.created_at > SESSION_TTL_MS) return { ok: false, reason: 'expired' };
    const dup = db.prepare('SELECT 1 FROM ad_sessions WHERE transaction_id = ?').get(transactionId);
    if (dup) return { ok: false, reason: 'duplicate_transaction' };

    // Re-check at reward time: the player may have started two sessions at once.
    if (s.purpose === 'points') {
      const why = refusal(adEligibility(db, cfg, s.user_id, s.competition_id!, now), cfg);
      if (why) return { ok: false, reason: why };
    }

    db.prepare('UPDATE ad_sessions SET rewarded_at = ?, transaction_id = ? WHERE id = ?').run(now, transactionId, sessionId);
    const balance =
      s.purpose === 'points'
        ? postLedger(db, { userId: s.user_id, competitionId: s.competition_id!, kind: 'ad_reward', amount: AD_REWARD_POINTS, ref: sessionId, at: now })
        : 0;
    return { ok: true, balance, userId: s.user_id, purpose: s.purpose, competitionId: s.competition_id };
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
