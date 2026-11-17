import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { buildApp } from '../src/app.ts';
import { openDb } from '../src/db.ts';
import { ingestOdds } from '../src/lines.ts';
import { et, FakeOddsApi, signUpPlayer, testConfig, testDb } from './helpers.ts';

const ADMIN = { authorization: 'Bearer admin-secret' };
const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const iso = (ms: number) => new Date(ms).toISOString();

function setup(now: number) {
  const db = testDb();
  const cfg = testConfig();
  let clock = now;
  const app = buildApp({ db, cfg, clock: () => clock });
  const create = (over: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: '/admin/competitions',
      headers: ADMIN,
      payload: { name: 'C', kind: 'weekly', prize: '$50 gift card', maxEntries: 500, startsAt: iso(et(2026, 11, 21, 0)), endsAt: iso(et(2026, 11, 28, 0)), ...over },
    });
  const list = async (qs = '', token?: string) => {
    const res = await app.inject({ method: 'GET', url: `/competitions${qs}`, headers: token ? auth(token) : {} });
    return res.json() as { competitions: { name: string }[]; nextOffset: number | null; sports: { key: string }[]; toClaim: unknown[] };
  };
  return { db, cfg, app, create, list, setClock: (t: number) => (clock = t) };
}

describe('browsing contests', () => {
  it('filters by size, start, sport, length and prize type, a page at a time', async () => {
    const { create, list } = setup(et(2026, 11, 20, 12));
    await create({ name: 'Small daily', kind: 'daily', maxEntries: 50, startsAt: iso(et(2026, 11, 21, 0)), endsAt: iso(et(2026, 11, 22, 0)) });
    await create({ name: 'Big weekly', maxEntries: 5000, startsAt: iso(et(2026, 11, 22, 0)), endsAt: iso(et(2026, 11, 29, 0)) });
    await create({ name: 'NBA weekly', sport: 'basketball_nba', maxEntries: 500 });
    await create({ name: 'NHL weekly', sport: 'icehockey_nhl', maxEntries: 500 });
    await create({ name: 'TV monthly', kind: 'monthly', prize: '55-inch TV', prizeType: 'physical', maxEntries: 800, startsAt: iso(et(2026, 11, 23, 0)), endsAt: iso(et(2026, 12, 23, 0)) });

    const names = async (qs: string) => (await list(qs)).competitions.map((c) => c.name).sort();
    expect(await names('')).toHaveLength(5);
    expect(await names('?sizeMax=100')).toEqual(['Small daily']);
    expect(await names('?sizeMin=1001')).toEqual(['Big weekly']);
    expect(await names('?sizeMin=101&sizeMax=1000')).toEqual(['NBA weekly', 'NHL weekly', 'TV monthly']);
    expect(await names('?sizeMin=500&sizeMax=500')).toEqual(['NBA weekly', 'NHL weekly']);
    expect(await names('?lengthMax=1')).toEqual(['Small daily']);
    expect(await names('?lengthMin=2&lengthMax=7')).toEqual(['Big weekly', 'NBA weekly', 'NHL weekly']);
    expect(await names('?lengthMin=7&lengthMax=7')).toEqual(['Big weekly', 'NBA weekly', 'NHL weekly']);
    expect(await names('?lengthMin=30')).toEqual(['TV monthly']);
    expect(await names('?prizeType=physical')).toEqual(['TV monthly']);
    // A sport shows its own contests plus the ones open to every sport.
    expect(await names('?sport=basketball_nba')).toEqual(['Big weekly', 'NBA weekly', 'Small daily', 'TV monthly']);
    expect(await names('?sport=any')).toEqual(['Big weekly', 'Small daily', 'TV monthly']);
    expect(await names(`?startFrom=${encodeURIComponent(iso(et(2026, 11, 22, 0)))}&startTo=${encodeURIComponent(iso(et(2026, 11, 23, 0)))}`)).toEqual(['Big weekly']);
    expect(await names('?sizeMin=101&sizeMax=1000&lengthMin=7&lengthMax=7&sport=icehockey_nhl')).toEqual(['NHL weekly']);

    const page1 = await list('?limit=2');
    expect(page1.competitions).toHaveLength(2);
    expect(page1.nextOffset).toBe(2);
    const page3 = await list('?limit=2&offset=4');
    expect(page3.competitions).toHaveLength(1);
    expect(page3.nextOffset).toBeNull();
    expect(page1.sports.map((s) => s.key)).toContain('basketball_nba');
  });

  it('sorts live first, then by start; popular sorts by entries; mine shows joined ones', async () => {
    const { app, create, list, setClock } = setup(et(2026, 11, 20, 12));
    const later = (await create({ name: 'Later', startsAt: iso(et(2026, 11, 25, 0)), endsAt: iso(et(2026, 12, 2, 0)) })).json().id;
    await create({ name: 'Sooner', startsAt: iso(et(2026, 11, 21, 0)), endsAt: iso(et(2026, 11, 28, 0)) });
    const a = await signUpPlayer(app, 'alice');
    await app.inject({ method: 'POST', url: `/competitions/${later}/join`, headers: auth(a) });
    expect((await list('')).competitions.map((c) => c.name)).toEqual(['Sooner', 'Later']);
    expect((await list('?sort=popular')).competitions.map((c) => c.name)).toEqual(['Later', 'Sooner']);
    expect((await list('?status=mine', a)).competitions.map((c) => c.name)).toEqual(['Later']);
    setClock(et(2026, 11, 22, 12));
    expect((await list('?status=live')).competitions.map((c) => c.name)).toEqual(['Sooner']);
    expect((await list('?status=upcoming')).competitions.map((c) => c.name)).toEqual(['Later']);
    expect((await app.inject({ method: 'GET', url: '/competitions?sizeMin=lots' })).statusCode).toBe(400);
  });

  it('only takes picks on the contest sport', async () => {
    const { db, cfg, app, create, setClock } = setup(et(2026, 11, 20, 12));
    const id = (await create({ name: 'NHL only', sport: 'icehockey_nhl', startsAt: iso(et(2026, 11, 21, 0)) })).json().id;
    const a = await signUpPlayer(app, 'alice');
    await app.inject({ method: 'POST', url: `/competitions/${id}/join`, headers: auth(a) });
    setClock(et(2026, 11, 21, 12));
    const api = new FakeOddsApi([{ id: 'g1', sport: 'basketball_nba', start: et(2026, 11, 21, 19), home: 'Knicks', away: 'Celtics' }], () => et(2026, 11, 21, 12));
    ingestOdds(db, (await api.getOdds('basketball_nba')).data, cfg.preferredBooks, et(2026, 11, 21, 12));
    const ad = await app.inject({ method: 'POST', url: '/ads/sessions', headers: auth(a), payload: { purpose: 'points', competitionId: id } });
    await app.inject({ method: 'POST', url: `/ads/sessions/${ad.json().sessionId}/stub-complete`, headers: auth(a) });
    const pickAd = await app.inject({ method: 'POST', url: '/ads/sessions', headers: auth(a), payload: { purpose: 'pick' } });
    await app.inject({ method: 'POST', url: `/ads/sessions/${pickAd.json().sessionId}/stub-complete`, headers: auth(a) });
    const res = await app.inject({
      method: 'POST',
      url: '/picks',
      headers: auth(a),
      payload: { competitionId: id, eventId: 'g1', market: 'moneyline', selection: 'home', points: 10, adSessionId: pickAd.json().sessionId },
    });
    expect(res.json().error).toBe('wrong_sport');
  });
});

describe('contact us', () => {
  it('saves messages for the admin page, a few a day', async () => {
    const { app } = setup(et(2026, 11, 20, 12));
    const a = await signUpPlayer(app, 'alice');
    const send = () => app.inject({ method: 'POST', url: '/contact', headers: auth(a), payload: { topic: 'question', body: 'When is the next NFL contest?' } });
    expect((await app.inject({ method: 'POST', url: '/contact', payload: { topic: 'question', body: 'hello there' } })).statusCode).toBe(401);
    for (let i = 0; i < 5; i++) expect((await send()).statusCode).toBe(200);
    expect((await send()).statusCode).toBe(429);
    const msgs = (await app.inject({ method: 'GET', url: '/admin/messages', headers: ADMIN })).json().messages;
    expect(msgs).toHaveLength(5);
    expect(msgs[0]).toMatchObject({ display_name: 'alice', topic: 'question', handled_at: null });
    expect(msgs[0].email).toContain('@');
    const done = await app.inject({ method: 'PUT', url: `/admin/messages/${msgs[0].id}`, headers: ADMIN, payload: { handled: true } });
    expect(done.statusCode).toBe(200);
  });
});

describe('upgrading an existing database', () => {
  it('adds the sport and prize type columns without losing contests', () => {
    const path = `/tmp/cys-migrate-${process.pid}-${Date.now()}.db`;
    const db = openDb(path);
    db.prepare(
      `INSERT INTO competitions (id, name, kind, prize, max_entries, starts_at, ends_at, created_at) VALUES ('c1', 'Old', 'weekly', 'Prize', 10, 1, 2, 0)`,
    ).run();
    db.close();
    // Simulate the earlier schema by rebuilding the table without the new columns.
    const raw = new DatabaseSync(path);
    raw.exec('PRAGMA foreign_keys = OFF');
    raw.exec(`CREATE TABLE c2 AS SELECT id, name, kind, prize, prize_details, prize_value, max_entries, starts_at, ends_at, created_at, winner_user_id, finalized_at FROM competitions`);
    raw.exec('DROP TABLE competitions');
    raw.exec('ALTER TABLE c2 RENAME TO competitions');
    raw.close();
    const again = openDb(path);
    expect(again.prepare('SELECT name, prize_type, sport FROM competitions').get()).toEqual({ name: 'Old', prize_type: 'gift_card', sport: null });
    again.close();
  });
});
