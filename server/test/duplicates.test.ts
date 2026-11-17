import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { openClaim, submitClaim } from '../src/claims.ts';
import { emailBase, legalNameKey, nameBase } from '../src/duplicates.ts';
import { testConfig, testDb } from './helpers.ts';

const ADMIN = { authorization: 'Bearer admin-secret' };
const NOW = Date.UTC(2026, 10, 17, 17);

function setup() {
  const db = testDb();
  const cfg = testConfig();
  const app = buildApp({ db, cfg, clock: () => NOW });
  let n = 0;
  const signUp = async (displayName: string, email: string, birthDate: string, region = 'NY') => {
    n++;
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signin',
      payload: { provider: 'google', idToken: `stub-dupes-${n}-xyz`, profile: { displayName, email, phone: `555-020-${1000 + n}`, country: 'US', region, birthDate, acceptedTerms: true } },
    });
    expect(res.statusCode).toBe(200);
    return res.json().user.id as string;
  };
  const groups = async () => (await app.inject({ method: 'GET', url: '/admin/duplicates', headers: ADMIN })).json().groups;
  return { db, cfg, app, signUp, groups };
}

describe('spotting the same person on more than one account', () => {
  it('normalizes names and emails for matching', () => {
    expect(emailBase('Mike.R+2@gmail.com')).toBe('miker');
    expect(emailBase('miker77@yahoo.com')).toBe('miker');
    expect(nameBase('hoops_mike2')).toBe('hoopsmike');
    expect(legalNameKey('  José  O’Neil ')).toBe('jose o neil');
  });

  it('flags accounts with the same birth date and state plus a similar email or name', async () => {
    const { signUp, groups } = setup();
    await signUp('hoops_mike', 'mike.r@gmail.com', '1990-03-04');
    await signUp('buckets99', 'mike.r77@yahoo.com', '1990-03-04'); // same email base
    await signUp('hoops_mike2', 'totally@other.com', '1990-03-04'); // same name base
    await signUp('someone', 'someone@x.com', '1990-03-04'); // same birthday and state only
    await signUp('mike_r', 'miker@yahoo.com', '1990-03-04', 'NJ'); // other state
    const g = await groups();
    expect(g).toHaveLength(1);
    expect(g[0].kind).toBe('account');
    expect(g[0].players.map((p: { displayName: string }) => p.displayName)).toEqual(['hoops_mike', 'buckets99', 'hoops_mike2']);
  });

  it('flags prize claims with the same legal name, birth date and state, and a birth date that differs from sign-up', async () => {
    const { db, cfg, app, signUp } = setup();
    const a = await signUp('alpha', 'a@a.com', '1985-01-02');
    const b = await signUp('bravo', 'b@b.com', '1985-01-02', 'NJ');
    for (const id of ['c1', 'c2']) {
      db.prepare(`INSERT INTO competitions (id, name, kind, prize, max_entries, starts_at, ends_at, created_at) VALUES (?, ?, 'weekly', '$50', 10, 1, 2, 0)`).run(id, id);
    }
    openClaim(db, 'c1', a, NOW);
    openClaim(db, 'c2', b, NOW);
    const form = { legalName: 'Sam Rivera', address: { line1: '9 Pine', city: 'Albany', region: 'NY', postalCode: '12207', country: 'US' as const }, birthDate: '1985-01-02' };
    expect(submitClaim(db, cfg, 'c1', a, form, NOW).ok).toBe(true);
    expect(submitClaim(db, cfg, 'c2', b, { ...form, legalName: 'sam  RIVERA', birthDate: '1985-01-02' }, NOW).ok).toBe(true);

    const dupes = (await app.inject({ method: 'GET', url: '/admin/duplicates', headers: ADMIN })).json().groups;
    expect(dupes[0]).toMatchObject({ kind: 'claim' });
    expect(dupes[0].players).toHaveLength(2);
    const claims = (await app.inject({ method: 'GET', url: '/admin/claims', headers: ADMIN })).json().claims;
    const bravo = claims.find((c: { display_name: string }) => c.display_name === 'bravo');
    expect(bravo.flags.join(' ')).toContain('Same person as alpha');

    // A claim birth date that doesn't match sign-up.
    db.prepare(`INSERT INTO competitions (id, name, kind, prize, max_entries, starts_at, ends_at, created_at) VALUES ('c3', 'c3', 'weekly', '$50', 10, 1, 2, 0)`).run();
    const c = await signUp('charlie', 'c@c.com', '1991-06-06');
    openClaim(db, 'c3', c, NOW);
    submitClaim(db, cfg, 'c3', c, { ...form, legalName: 'Charlie Day', birthDate: '1990-06-06' }, NOW);
    const after = (await app.inject({ method: 'GET', url: '/admin/claims', headers: ADMIN })).json().claims;
    expect(after.find((x: { display_name: string }) => x.display_name === 'charlie').flags[0]).toContain('different from sign-up');
  });
});
