// Prize claims. When a contest is finalized, its winner gets a claim. The
// winner fills in a claim form in the app (legal name, mailing address, birth
// date and, for US prizes worth $600 or more, a tax id). The form is stored
// encrypted with CLAIMS_KEY, separately from the player's profile, and only
// the admin page can read it.
//
// Status: pending (waiting on the winner) -> submitted (form in) ->
// verified -> paid, or ineligible / rejected.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { Config } from './config.ts';
import type { DB } from './db.ts';
import { ageOfMajority, ageOn, checkRegion, skillQuestion, type Country } from './eligibility.ts';

export const CLAIM_STATUSES = ['pending', 'submitted', 'verified', 'paid', 'ineligible', 'rejected'] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

/** US prizes at or above this value (in dollars) need a tax id for a 1099. */
export const TAX_ID_THRESHOLD = 600;

export interface ClaimForm {
  legalName: string;
  address: { line1: string; line2?: string; city: string; region: string; postalCode: string; country: Country };
  birthDate: string;
  taxId?: string;
  skillAnswer?: number;
}

export interface ClaimRow {
  competition_id: string;
  user_id: string;
  status: ClaimStatus;
  data_enc: string | null;
  skill_attempts: number;
  note: string;
  created_at: number;
  updated_at: number;
}

function key(cfg: Config): Buffer | null {
  if (!cfg.claimsKey) return null;
  // Any length of secret works; it is stretched to a 256-bit key.
  return createHash('sha256').update(cfg.claimsKey).digest();
}

export function encrypt(cfg: Config, data: unknown): string {
  const k = key(cfg);
  if (!k) throw new Error('CLAIMS_KEY is not set');
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', k, iv);
  const body = Buffer.concat([c.update(JSON.stringify(data), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), body.toString('base64')].join('.');
}

export function decrypt(cfg: Config, blob: string): unknown {
  const k = key(cfg);
  if (!k) throw new Error('CLAIMS_KEY is not set');
  const [v, iv, tag, body] = blob.split('.');
  if (v !== 'v1' || !iv || !tag || !body) throw new Error('bad claim blob');
  const d = createDecipheriv('aes-256-gcm', k, Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(body, 'base64')), d.final()]).toString('utf8'));
}

export function openClaim(db: DB, competitionId: string, userId: string, now: number): void {
  db.prepare(
    `INSERT INTO prize_claims (competition_id, user_id, status, created_at, updated_at) VALUES (?, ?, 'pending', ?, ?)
     ON CONFLICT (competition_id, user_id) DO NOTHING`,
  ).run(competitionId, userId, now, now);
}

export function getClaim(db: DB, competitionId: string, userId: string): ClaimRow | null {
  return (db.prepare('SELECT * FROM prize_claims WHERE competition_id = ? AND user_id = ?').get(competitionId, userId) as ClaimRow | undefined) ?? null;
}

/** What the winner's claim screen needs to show. */
export function claimInfo(db: DB, competitionId: string, userId: string) {
  const claim = getClaim(db, competitionId, userId);
  if (!claim) return null;
  const c = db.prepare('SELECT prize, prize_value FROM competitions WHERE id = ?').get(competitionId) as { prize: string; prize_value: number };
  const u = db.prepare('SELECT country, region, birth_date FROM users WHERE id = ?').get(userId) as { country: Country; region: string; birth_date: string | null };
  return {
    status: claim.status,
    note: claim.note,
    prize: c.prize,
    country: u.country,
    region: u.region,
    /** From sign-up, to prefill the form. */
    birthDate: u.birth_date,
    needsTaxId: u.country === 'US' && c.prize_value >= TAX_ID_THRESHOLD,
    skillQuestion: u.country === 'CA' ? skillQuestion(competitionId).text : null,
  };
}

export type SubmitResult =
  | { ok: true; status: ClaimStatus }
  | {
      ok: false;
      error: 'not_winner' | 'already_submitted' | 'not_configured' | 'bad_form' | 'bad_birth_date' | 'region_not_eligible' | 'wrong_answer' | 'too_many_attempts' | 'tax_id_required';
    }
  | { ok: false; error: 'under_age'; minimumAge: number };

const MAX_SKILL_ATTEMPTS = 3;

export function submitClaim(db: DB, cfg: Config, competitionId: string, userId: string, form: ClaimForm, now: number): SubmitResult {
  const claim = getClaim(db, competitionId, userId);
  if (!claim) return { ok: false, error: 'not_winner' };
  if (claim.status !== 'pending') return { ok: false, error: 'already_submitted' };
  if (!cfg.claimsKey) return { ok: false, error: 'not_configured' };
  const a = form.address;
  if (!form.legalName.trim() || !a.line1.trim() || !a.city.trim() || !a.postalCode.trim()) return { ok: false, error: 'bad_form' };
  const where = checkRegion(a.country, a.region);
  if (!where.ok) return { ok: false, error: where.error === 'bad_region' ? 'bad_form' : 'region_not_eligible' };

  const info = claimInfo(db, competitionId, userId)!;
  if (info.needsTaxId && !(form.taxId && /^\d{3}-?\d{2}-?\d{4}$/.test(form.taxId.trim()))) return { ok: false, error: 'tax_id_required' };

  // Canadian winners answer the skill-testing question first.
  if (a.country === 'CA') {
    if (claim.skill_attempts >= MAX_SKILL_ATTEMPTS) return { ok: false, error: 'too_many_attempts' };
    if (form.skillAnswer !== skillQuestion(competitionId).answer) {
      db.prepare('UPDATE prize_claims SET skill_attempts = skill_attempts + 1, updated_at = ? WHERE competition_id = ? AND user_id = ?').run(now, competitionId, userId);
      return { ok: false, error: claim.skill_attempts + 1 >= MAX_SKILL_ATTEMPTS ? 'too_many_attempts' : 'wrong_answer' };
    }
  }

  const age = ageOn(form.birthDate, now);
  if (age === null) return { ok: false, error: 'bad_birth_date' };
  const min = ageOfMajority(a.country, a.region);
  const data = encrypt(cfg, { ...form, skillAnswer: undefined, skillPassed: a.country === 'CA' ? true : undefined });
  if (age < min) {
    db.prepare("UPDATE prize_claims SET status = 'ineligible', data_enc = ?, note = ?, updated_at = ? WHERE competition_id = ? AND user_id = ?").run(
      data,
      `Under ${min}, the age of majority in ${a.region}.`,
      now,
      competitionId,
      userId,
    );
    return { ok: false, error: 'under_age', minimumAge: min };
  }
  db.prepare("UPDATE prize_claims SET status = 'submitted', data_enc = ?, updated_at = ? WHERE competition_id = ? AND user_id = ?").run(data, now, competitionId, userId);
  return { ok: true, status: 'submitted' };
}

/** For the admin page: every claim, with the form decrypted. */
export function listClaims(db: DB, cfg: Config) {
  const rows = db
    .prepare(
      `SELECT pc.*, c.name AS contest, c.prize, c.prize_value, u.display_name, u.email, u.phone, u.country, u.region
       FROM prize_claims pc JOIN competitions c ON c.id = pc.competition_id JOIN users u ON u.id = pc.user_id
       ORDER BY pc.updated_at DESC LIMIT 200`,
    )
    .all() as (ClaimRow & Record<string, unknown>)[];
  return rows.map(({ data_enc, ...r }) => {
    let form: unknown = null;
    if (data_enc) {
      try {
        form = decrypt(cfg, data_enc);
      } catch {
        form = { error: 'Could not decrypt. Was CLAIMS_KEY changed?' };
      }
    }
    return { ...r, form };
  });
}

export function setClaimStatus(db: DB, competitionId: string, userId: string, status: ClaimStatus, note: string | undefined, now: number): boolean {
  const res = db
    .prepare('UPDATE prize_claims SET status = ?, note = COALESCE(?, note), updated_at = ? WHERE competition_id = ? AND user_id = ?')
    .run(status, note ?? null, now, competitionId, userId);
  return res.changes === 1;
}
