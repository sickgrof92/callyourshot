// Sign in with Apple or Google, plus an email and phone number at sign-up.
//
// One account per person is encouraged cheaply: an email or phone number that
// is already on another account is refused. Emails are compared
// case-insensitively, ignoring "+tags" (and dots for Gmail), so
// mike+2@gmail.com and m.ike@gmail.com count as mike@gmail.com.
//
// SMS verification is not on yet. Accounts store `phone_verified_at` (null for
// now); turning on verification later means sending a code before sign-up and
// setting that column, without changing anything else here.
//
// AUTH_MODE=stub (default, for Expo Go and testing) accepts identity tokens of
// the form "stub-<anything>" without checking them. AUTH_MODE=live verifies
// real Apple and Google identity tokens against their published keys and
// refuses stub tokens.

import { createPublicKey, createVerify, type JsonWebKey } from 'node:crypto';
import type { Config } from './config.ts';

export const PROVIDERS = ['apple', 'google'] as const;
export type Provider = (typeof PROVIDERS)[number];

export interface Identity {
  provider: Provider;
  /** The provider's stable user id. */
  sub: string;
  /** Email from the provider, if it shared one (prefills the sign-up form). */
  email: string | null;
}

/** US numbers can be typed without +1; anything else needs a leading +country code. */
export function normalizePhone(raw: string): string | null {
  const t = raw.trim();
  const digits = t.replace(/\D/g, '');
  if (/[^\d\s()+.-]/.test(t)) return null;
  if (t.startsWith('+')) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The key two emails share if they reach the same inbox, or null if it isn't an email. */
export function emailKey(raw: string): string | null {
  const e = raw.trim().toLowerCase();
  if (!EMAIL_RE.test(e) || e.length > 254) return null;
  const at = e.lastIndexOf('@');
  let local = e.slice(0, at);
  let domain = e.slice(at + 1);
  local = local.split('+')[0]!;
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.replace(/\./g, '');
  if (!local) return null;
  return `${local}@${domain}`;
}

// ---- Identity token verification ------------------------------------------

const ISSUERS: Record<Provider, string[]> = {
  apple: ['https://appleid.apple.com'],
  google: ['https://accounts.google.com', 'accounts.google.com'],
};
const JWKS_URLS: Record<Provider, string> = {
  apple: 'https://appleid.apple.com/auth/keys',
  google: 'https://www.googleapis.com/oauth2/v3/certs',
};

type Jwk = JsonWebKey & { kid?: string };

export class IdentityVerifier {
  private cache = new Map<Provider, { keys: Jwk[]; at: number }>();

  constructor(
    private cfg: Config,
    private fetchJwks: (url: string) => Promise<{ keys: Jwk[] }> = async (url) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`JWKS ${res.status}`);
      return (await res.json()) as { keys: Jwk[] };
    },
  ) {}

  private async keys(provider: Provider, now: number, force = false): Promise<Jwk[]> {
    const hit = this.cache.get(provider);
    if (hit && !force && now - hit.at < 3600_000) return hit.keys;
    const { keys } = await this.fetchJwks(JWKS_URLS[provider]);
    this.cache.set(provider, { keys, at: now });
    return keys;
  }

  /** Returns the identity, or null if the token isn't valid for this app. */
  async verify(provider: Provider, idToken: string, now: number): Promise<Identity | null> {
    if (this.cfg.authMode === 'stub') {
      const m = /^stub-([A-Za-z0-9_.:-]{6,100})$/.exec(idToken);
      return m ? { provider, sub: m[1]!, email: null } : null;
    }
    const parts = idToken.split('.');
    if (parts.length !== 3) return null;
    let header: { alg?: string; kid?: string };
    let claims: { iss?: string; aud?: string; sub?: string; exp?: number; email?: string; email_verified?: boolean | string };
    try {
      header = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString('utf8'));
      claims = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'));
    } catch {
      return null;
    }
    if (header.alg !== 'RS256' || !header.kid) return null;
    let jwk = (await this.keys(provider, now)).find((k) => k.kid === header.kid);
    if (!jwk) jwk = (await this.keys(provider, now, true)).find((k) => k.kid === header.kid); // keys rotated
    if (!jwk) return null;
    const ok = createVerify('RSA-SHA256')
      .update(`${parts[0]}.${parts[1]}`)
      .verify(createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2]!, 'base64url'));
    if (!ok) return null;
    const audiences = provider === 'apple' ? this.cfg.appleClientIds : this.cfg.googleClientIds;
    if (!claims.iss || !ISSUERS[provider].includes(claims.iss)) return null;
    if (!claims.aud || !audiences.includes(claims.aud)) return null;
    if (!claims.exp || claims.exp * 1000 < now - 60_000) return null;
    if (!claims.sub) return null;
    const verified = claims.email_verified === true || claims.email_verified === 'true';
    return { provider, sub: claims.sub, email: claims.email && verified ? claims.email : null };
  }
}
