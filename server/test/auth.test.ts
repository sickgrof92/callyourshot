import { generateKeyPairSync, createSign, type JsonWebKey } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { emailKey, IdentityVerifier, normalizePhone } from '../src/auth.ts';
import { testConfig, testDb } from './helpers.ts';

const signin = (app: ReturnType<typeof buildApp>, payload: object) => app.inject({ method: 'POST', url: '/auth/signin', payload });
const profile = (over: object = {}) => ({
  displayName: 'mike',
  email: 'mike@gmail.com',
  phone: '(555) 123-4567',
  country: 'US',
  region: 'NY',
  acceptedTerms: true,
  ...over,
});

describe('normalizing contact details', () => {
  it('treats Gmail dots, +tags and case as the same address', () => {
    expect(emailKey('Mike.Smith+cys@Gmail.com')).toBe('mikesmith@gmail.com');
    expect(emailKey('m.i.k.e.smith@googlemail.com')).toBe('mikesmith@gmail.com');
    expect(emailKey('Mike.Smith+2@outlook.com')).toBe('mike.smith@outlook.com');
    expect(emailKey('not an email')).toBeNull();
  });

  it('reads US numbers with or without +1 and international numbers with +', () => {
    expect(normalizePhone('(555) 123-4567')).toBe('+15551234567');
    expect(normalizePhone('1-555-123-4567')).toBe('+15551234567');
    expect(normalizePhone('+44 20 7946 0958')).toBe('+442079460958');
    expect(normalizePhone('12345')).toBeNull();
    expect(normalizePhone('555-CALL-NOW')).toBeNull();
  });
});

describe('sign-in', () => {
  it('asks a new player for their details, then signs them back in without asking again', async () => {
    const app = buildApp({ db: testDb(), cfg: testConfig() });
    const first = await signin(app, { provider: 'google', idToken: 'stub-abc123' });
    expect(first.json()).toMatchObject({ needsProfile: true });

    const made = await signin(app, { provider: 'google', idToken: 'stub-abc123', profile: profile() });
    expect(made.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/me', headers: { authorization: `Bearer ${made.json().token}` } })).json().displayName).toBe('mike');

    const again = await signin(app, { provider: 'google', idToken: 'stub-abc123' });
    expect(again.json().user.displayName).toBe('mike');
    expect(again.json().token).not.toBe(made.json().token);
  });

  it('refuses an email or phone number already on another account', async () => {
    const app = buildApp({ db: testDb(), cfg: testConfig() });
    await signin(app, { provider: 'google', idToken: 'stub-first1', profile: profile() });
    const sameEmail = await signin(app, { provider: 'apple', idToken: 'stub-second', profile: profile({ displayName: 'mike2', email: 'M.ike+alt@gmail.com', phone: '555-000-1111' }) });
    expect(sameEmail.json().error).toBe('email_taken');
    const samePhone = await signin(app, { provider: 'apple', idToken: 'stub-second', profile: profile({ displayName: 'mike2', email: 'other@example.com', phone: '+1 555 123 4567' }) });
    expect(samePhone.json().error).toBe('phone_taken');
    const sameName = await signin(app, { provider: 'apple', idToken: 'stub-second', profile: profile({ displayName: 'MIKE', email: 'other@example.com', phone: '555-000-1111' }) });
    expect(sameName.json().error).toBe('name_taken');
    expect((await signin(app, { provider: 'apple', idToken: 'stub-second', profile: profile({ displayName: 'mike2', email: 'bad', phone: '555-000-1111' }) })).json().error).toBe('bad_email');
    expect((await signin(app, { provider: 'apple', idToken: 'stub-second', profile: profile({ displayName: 'mike2', email: 'o@example.com', phone: '12' }) })).json().error).toBe('bad_phone');
    const ok = await signin(app, { provider: 'apple', idToken: 'stub-second', profile: profile({ displayName: 'mike2', email: 'other@example.com', phone: '555-000-1111' }) });
    expect(ok.statusCode).toBe(200);
  });

  it('only signs up players in the US or Canada outside Quebec, who accept the rules', async () => {
    const app = buildApp({ db: testDb(), cfg: testConfig() });
    const go = (over: object) => signin(app, { provider: 'apple', idToken: 'stub-where12', profile: profile(over) });
    expect((await go({ country: 'CA', region: 'QC' })).json().error).toBe('region_not_eligible');
    expect((await go({ country: 'US', region: 'ON' })).json().error).toBe('bad_region');
    expect((await go({ country: 'MX', region: 'JA' })).statusCode).toBe(400);
    expect((await go({ acceptedTerms: false })).statusCode).toBe(400);
    expect((await go({ country: 'CA', region: 'on' })).statusCode).toBe(200);
  });

  it('has no guest sign-up any more', async () => {
    const app = buildApp({ db: testDb(), cfg: testConfig() });
    expect((await app.inject({ method: 'POST', url: '/auth/guest', payload: { displayName: 'x' } })).statusCode).toBe(404);
  });
});

describe('live identity tokens', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...(publicKey.export({ format: 'jwk' }) as JsonWebKey), kid: 'k1', alg: 'RS256', use: 'sig' };
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const sign = (claims: object, kid = 'k1') => {
    const head = b64({ alg: 'RS256', kid });
    const body = b64(claims);
    const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(privateKey).toString('base64url');
    return `${head}.${body}.${sig}`;
  };
  const now = Date.UTC(2026, 10, 16);
  const cfg = testConfig({ authMode: 'live', googleClientIds: ['web-client.apps.googleusercontent.com'], appleClientIds: ['com.callyourshot.app'] });
  const v = new IdentityVerifier(cfg, async () => ({ keys: [jwk] }));
  const good = { iss: 'https://accounts.google.com', aud: 'web-client.apps.googleusercontent.com', sub: 'g-1', exp: now / 1000 + 600, email: 'a@b.com', email_verified: true };

  it('accepts a correctly signed Google token for this app', async () => {
    expect(await v.verify('google', sign(good), now)).toEqual({ provider: 'google', sub: 'g-1', email: 'a@b.com' });
  });

  it('rejects stub tokens, other apps, expired tokens and bad signatures', async () => {
    expect(await v.verify('google', 'stub-abc123', now)).toBeNull();
    expect(await v.verify('google', sign({ ...good, aud: 'someone-else' }), now)).toBeNull();
    expect(await v.verify('google', sign({ ...good, exp: now / 1000 - 3600 }), now)).toBeNull();
    expect(await v.verify('apple', sign(good), now)).toBeNull(); // Google issuer on an Apple sign-in
    const t = sign(good).split('.');
    expect(await v.verify('google', `${t[0]}.${b64({ ...good, sub: 'g-2' })}.${t[2]}`, now)).toBeNull();
    expect(await v.verify('google', sign(good, 'unknown'), now)).toBeNull();
  });
});
