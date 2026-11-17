import { generateKeyPairSync, createSign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { decrypt } from '../src/claims.ts';
import { contestStandings, createCompetition, finalizeCompetition, getCompetition } from '../src/competitions.ts';
import { ageOfMajority, ageOn, skillQuestion } from '../src/eligibility.ts';
import { et, signUpPlayer, testConfig, testDb } from './helpers.ts';

const ADMIN = { authorization: 'Bearer admin-secret' };
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

function setup() {
  const db = testDb();
  const cfg = testConfig();
  let clock = et(2026, 11, 21, 12);
  const app = buildApp({ db, cfg, clock: () => clock });
  const r = createCompetition(
    db,
    { name: 'Weekly', kind: 'weekly', prize: '$2,000 cash', prizeValue: 2000, prizeDetails: '', maxEntries: 100, startsAt: et(2026, 11, 21, 0), endsAt: et(2026, 11, 28, 0) },
    et(2026, 11, 20, 0),
  );
  if (!r.ok) throw new Error(r.error);
  const cid = r.value.id;
  return { db, cfg, app, cid, setClock: (t: number) => (clock = t) };
}

/** Put a player in the contest with a given record. */
function entrant(db: ReturnType<typeof testDb>, cid: string, userId: string, o: { balance: number; refills: number; wins: number; losses: number }) {
  db.prepare('INSERT INTO competition_entries (competition_id, user_id, joined_at, balance) VALUES (?, ?, 0, ?)').run(cid, userId, o.balance);
  for (let i = 0; i < o.refills; i++) {
    db.prepare("INSERT INTO ad_sessions (id, user_id, purpose, competition_id, created_at, rewarded_at) VALUES (?, ?, 'points', ?, 0, 1)").run(`${userId}-ad${i}`, userId, cid);
  }
  db.prepare("INSERT OR IGNORE INTO events (id, sport, home_team, away_team, commence_time, updated_at) VALUES ('e', 'basketball_nba', 'H', 'A', 0, 0)").run();
  const pick = (status: string, i: number) =>
    db.prepare("INSERT INTO picks (id, user_id, competition_id, event_id, market, selection, price, stake, status, created_at) VALUES (?, ?, ?, 'e', ?, 'home', -110, 10, ?, 0)").run(
      `${userId}-${status}${i}`,
      userId,
      cid,
      `m${status}${i}`,
      status,
    );
  for (let i = 0; i < o.wins; i++) pick('won', i);
  for (let i = 0; i < o.losses; i++) pick('lost', i);
}

describe('tiebreakers', () => {
  it('ranks by points, then fewest refills, then win %, then most wins; still-tied players share the win', async () => {
    const { db, app, cid, setClock } = setup();
    for (const [id, name] of [['a', 'amy'], ['b', 'ben'], ['c', 'cal'], ['d', 'dee'], ['e', 'eve'], ['f', 'fay']]) {
      db.prepare('INSERT INTO users (id, display_name, token_hash, created_at) VALUES (?, ?, ?, 0)').run(id, name, `h${id}`);
    }
    entrant(db, cid, 'a', { balance: 100, refills: 3, wins: 5, losses: 5 }); // most points
    entrant(db, cid, 'b', { balance: 80, refills: 2, wins: 1, losses: 9 }); // fewer refills beats better record
    entrant(db, cid, 'c', { balance: 80, refills: 3, wins: 3, losses: 1 }); // 75%
    entrant(db, cid, 'd', { balance: 80, refills: 3, wins: 6, losses: 4 }); // 60%, more wins than e
    entrant(db, cid, 'e', { balance: 80, refills: 3, wins: 3, losses: 2 }); // 60%
    entrant(db, cid, 'f', { balance: 80, refills: 3, wins: 3, losses: 2 }); // identical to e
    const c = getCompetition(db, cid)!;
    const s = contestStandings(db, c);
    expect(s.map((r) => [r.displayName, r.rank])).toEqual([
      ['amy', 1],
      ['ben', 2],
      ['cal', 3],
      ['dee', 4],
      ['eve', 5],
      ['fay', 5],
    ]);
    expect(s[2]).toMatchObject({ refills: 3, wins: 3, losses: 1, winPct: 0.75 });

    // A tie at the very top: both win the full prize.
    db.prepare("UPDATE competition_entries SET balance = 100 WHERE user_id IN ('e', 'f')").run();
    db.prepare("UPDATE competition_entries SET balance = 50 WHERE user_id = 'a'").run();
    setClock(et(2026, 11, 28, 1));
    const fin = finalizeCompetition(db, cid, et(2026, 11, 28, 1));
    expect(fin.ok).toBe(true);
    const json = (await app.inject({ method: 'GET', url: `/competitions/${cid}` })).json();
    expect(json.competition.winner).toBe('eve & fay');
    const claims = (await app.inject({ method: 'GET', url: '/admin/claims', headers: ADMIN })).json().claims;
    expect(claims.map((x: { display_name: string; status: string }) => [x.display_name, x.status]).sort()).toEqual([
      ['eve', 'pending'],
      ['fay', 'pending'],
    ]);
  });
});

describe('prize claims', () => {
  async function win(where: { country: 'US' | 'CA'; region: string }) {
    const s = setup();
    const token = await signUpPlayer(s.app, 'winner', where);
    await s.app.inject({ method: 'POST', url: `/competitions/${s.cid}/join`, headers: auth(token) });
    const uid = (await s.app.inject({ method: 'GET', url: '/me', headers: auth(token) })).json().id;
    s.db.prepare('UPDATE competition_entries SET balance = 50 WHERE user_id = ?').run(uid);
    s.setClock(et(2026, 11, 28, 1));
    expect(finalizeCompetition(s.db, s.cid, et(2026, 11, 28, 1)).ok).toBe(true);
    const claim = (body: object) => s.app.inject({ method: 'POST', url: `/competitions/${s.cid}/claim`, headers: auth(token), payload: body });
    return { ...s, token, uid, claim };
  }
  const form = (over: object = {}) => ({
    legalName: 'Michael Example',
    address: { line1: '1 Main St', city: 'Buffalo', region: 'NY', postalCode: '14201', country: 'US' },
    birthDate: '1990-05-01',
    taxId: '123-45-6789',
    ...over,
  });

  it('collects the winner form encrypted, asks for a tax id when US prizes reach $2,000 in a year, and the admin moves it to verified and paid', async () => {
    const { app, db, cfg, cid, uid, token, claim } = await win({ country: 'US', region: 'NY' });
    const info = (await app.inject({ method: 'GET', url: `/competitions/${cid}/claim`, headers: auth(token) })).json();
    expect(info).toMatchObject({ status: 'pending', needsTaxId: true, skillQuestion: null });
    expect((await app.inject({ method: 'GET', url: `/competitions/${cid}`, headers: auth(token) })).json().competition.claim).toBe('pending');

    expect((await claim(form({ taxId: undefined }))).json().error).toBe('tax_id_required');
    expect((await claim(form())).json()).toEqual({ status: 'submitted' });
    expect((await claim(form())).json().error).toBe('already_submitted');

    // Stored encrypted: nothing readable in the database.
    const raw = db.prepare('SELECT data_enc FROM prize_claims WHERE user_id = ?').get(uid) as { data_enc: string };
    expect(raw.data_enc).not.toContain('Michael');
    expect(raw.data_enc).not.toContain('123-45');
    expect(decrypt(cfg, raw.data_enc)).toMatchObject({ legalName: 'Michael Example', taxId: '123-45-6789' });

    const list = (await app.inject({ method: 'GET', url: '/admin/claims', headers: ADMIN })).json();
    expect(list.claims[0]).toMatchObject({ status: 'submitted', form: { legalName: 'Michael Example' }, email: expect.stringContaining('@'), yearTotal: 2000, needsTaxForm: true });
    expect((await app.inject({ method: 'GET', url: '/admin/claims' })).statusCode).toBe(403);
    for (const status of ['verified', 'paid']) {
      expect((await app.inject({ method: 'PUT', url: `/admin/claims/${cid}/${uid}`, headers: ADMIN, payload: { status } })).statusCode).toBe(200);
    }
    expect((await app.inject({ method: 'GET', url: `/competitions/${cid}`, headers: auth(token) })).json().competition.claim).toBe('paid');
  });

  it('enforces the age of majority where the winner lives', async () => {
    const { claim } = await win({ country: 'US', region: 'AL' });
    const r = await claim(form({ birthDate: '2008-01-01', address: { line1: '1 Main St', city: 'Mobile', region: 'AL', postalCode: '36602', country: 'US' } }));
    expect(r.json()).toMatchObject({ error: 'under_age', minimumAge: 19 });
    expect((await claim(form())).json().error).toBe('already_submitted'); // marked ineligible
  });

  it('asks Canadian winners a skill-testing question, with 3 tries', async () => {
    const { app, cid, token, claim } = await win({ country: 'CA', region: 'BC' });
    const info = (await app.inject({ method: 'GET', url: `/competitions/${cid}/claim`, headers: auth(token) })).json();
    expect(info.skillQuestion).toMatch(/^\d+ × \d+ \+ \d+ − \d+$/);
    expect(info.needsTaxId).toBe(false);
    const ca = (over: object) =>
      form({ taxId: undefined, address: { line1: '1 Main St', city: 'Victoria', region: 'BC', postalCode: 'V8W 1A1', country: 'CA' }, ...over });
    const answer = skillQuestion(cid).answer;
    expect((await claim(ca({ skillAnswer: answer + 1 }))).json().error).toBe('wrong_answer');
    expect((await claim(ca({ skillAnswer: answer, birthDate: '2008-01-01' }))).json()).toMatchObject({ error: 'under_age', minimumAge: 19 });
  });

  it('does not accept claims from anyone but the winner, or from Quebec addresses', async () => {
    const s = await win({ country: 'CA', region: 'ON' });
    const other = await signUpPlayer(s.app, 'someone');
    expect((await s.app.inject({ method: 'POST', url: `/competitions/${s.cid}/claim`, headers: auth(other), payload: form() })).statusCode).toBe(404);
    const qc = form({ address: { line1: '1 rue', city: 'Montréal', region: 'QC', postalCode: 'H2X 1Y4', country: 'CA' }, skillAnswer: skillQuestion(s.cid).answer });
    expect((await s.claim(qc)).json().error).toBe('region_not_eligible');
  });

  it('works out ages and the age of majority', () => {
    expect(ageOn('2008-11-21', et(2026, 11, 21, 12))).toBe(18);
    expect(ageOn('2008-11-22', et(2026, 11, 21, 12))).toBe(17);
    expect(ageOn('2008-02-30', et(2026, 11, 21, 12))).toBeNull();
    expect([ageOfMajority('US', 'NY'), ageOfMajority('US', 'MS'), ageOfMajority('CA', 'ON'), ageOfMajority('CA', 'BC')]).toEqual([18, 21, 18, 19]);
  });
});

describe('ad fraud protection', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const keysFetch = (async () => new Response(JSON.stringify({ keys: [{ keyId: 7, pem }] }))) as unknown as typeof fetch;
  const signed = (q: string) => `${q}&signature=${createSign('sha256').update(q).sign(privateKey).toString('base64url')}&key_id=7`;

  it('only grants points from a signed AdMob callback for the right player, ad unit and time; the app cannot grant them', async () => {
    const db = testDb();
    const cfg = testConfig({ adProvider: 'admob', admobAdUnits: ['111'] });
    const now = et(2026, 11, 21, 12);
    const app = buildApp({ db, cfg, clock: () => now, fetchImpl: keysFetch });
    const r = createCompetition(db, { name: 'W', kind: 'weekly', prize: 'p', prizeDetails: '', maxEntries: 9, startsAt: et(2026, 11, 21, 0), endsAt: et(2026, 11, 28, 0) }, et(2026, 11, 20, 0));
    if (!r.ok) throw new Error(r.error);
    const token = await signUpPlayer(app, 'alice');
    await app.inject({ method: 'POST', url: `/competitions/${r.value.id}/join`, headers: auth(token) });
    const uid = (await app.inject({ method: 'GET', url: '/me', headers: auth(token) })).json().id;
    const sid = (await app.inject({ method: 'POST', url: '/ads/sessions', headers: auth(token), payload: { purpose: 'points', competitionId: r.value.id } })).json().sessionId;

    // The client can't complete an ad itself.
    expect((await app.inject({ method: 'POST', url: `/ads/sessions/${sid}/stub-complete`, headers: auth(token) })).statusCode).toBe(404);

    const ssv = async (o: { user?: string; unit?: string; ts?: number; tx?: string }) => {
      const q = `ad_network=1&ad_unit=${o.unit ?? '111'}&custom_data=${sid}&reward_amount=10&reward_item=points&timestamp=${o.ts ?? now}&transaction_id=${o.tx ?? 't1'}&user_id=${o.user ?? uid}`;
      return (await app.inject({ method: 'GET', url: `/ads/admob/ssv?${signed(q)}` })).json();
    };
    expect(await ssv({ user: 'someone-else' })).toMatchObject({ granted: false, reason: 'wrong_user' });
    expect(await ssv({ unit: '999' })).toMatchObject({ granted: false, reason: 'wrong_ad_unit' });
    expect(await ssv({ ts: now - 3 * 3600_000 })).toMatchObject({ granted: false, reason: 'stale' });
    expect((await app.inject({ method: 'GET', url: `/ads/sessions/${sid}`, headers: auth(token) })).json()).toMatchObject({ rewarded: false, balance: 0 });
    expect(await ssv({})).toMatchObject({ granted: true });
    expect(await ssv({ tx: 't2' })).toMatchObject({ granted: false }); // one reward per session
    expect((await app.inject({ method: 'GET', url: `/ads/sessions/${sid}`, headers: auth(token) })).json()).toMatchObject({ rewarded: true, balance: 10 });
  });
});

describe('public profiles', () => {
  it("shows career W-L-T, win %, longest win streak and reloads, but nothing private", async () => {
    const { db, app, cid } = setup();
    const token = await signUpPlayer(app, 'streaky');
    const uid = (await app.inject({ method: 'GET', url: '/me', headers: auth(token) })).json().id;
    db.prepare('INSERT INTO competition_entries (competition_id, user_id, joined_at) VALUES (?, ?, 0)').run(cid, uid);
    for (let i = 0; i < 2; i++) db.prepare("INSERT INTO ad_sessions (id, user_id, purpose, competition_id, created_at, rewarded_at) VALUES (?, ?, 'points', ?, 0, 1)").run(`r${i}`, uid, cid);
    // Results in game order: W W L W W W P L (a push doesn't break a streak)
    ['won', 'won', 'lost', 'won', 'won', 'won', 'push', 'lost'].forEach((status, i) => {
      db.prepare("INSERT INTO events (id, sport, home_team, away_team, commence_time, updated_at) VALUES (?, 'x', 'H', 'A', ?, 0)").run(`ev${i}`, i);
      db.prepare("INSERT INTO picks (id, user_id, competition_id, event_id, market, selection, price, stake, status, created_at) VALUES (?, ?, ?, ?, 'moneyline', 'home', -110, 10, ?, 0)").run(`pk${i}`, uid, cid, `ev${i}`, status);
    });
    const res = await app.inject({ method: 'GET', url: '/players/streaky' });
    expect(res.json()).toMatchObject({ displayName: 'streaky', wins: 5, losses: 2, ties: 1, longestWinStreak: 3, currentWinStreak: 0, reloads: 2, contestsJoined: 1 });
    expect(res.json().winPct).toBeCloseTo(5 / 7);
    expect(res.body).not.toMatch(/@|\+1555|NY|phone|email|region/);
    expect((await app.inject({ method: 'GET', url: '/players/nobody' })).statusCode).toBe(404);
  });
});
