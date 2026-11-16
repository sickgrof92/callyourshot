import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { gradeEvent } from '../src/grading.ts';
import { applyScores, ingestOdds } from '../src/lines.ts';
import { et, FakeOddsApi, testConfig, testDb } from './helpers.ts';
import { signUpPlayer } from './helpers.ts';

const ADMIN = { authorization: 'Bearer admin-secret' };
const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const iso = (ms: number) => new Date(ms).toISOString();

function setup(now: number) {
  const db = testDb();
  const cfg = testConfig();
  let clock = now;
  const app = buildApp({ db, cfg, clock: () => clock });
  const api = new FakeOddsApi(
    [{ id: 'g1', sport: 'basketball_nba', start: et(2026, 11, 21, 19), home: 'Knicks', away: 'Celtics', homeScore: 110, awayScore: 100 }],
    () => clock,
  );
  return {
    db,
    app,
    setClock: (t: number) => (clock = t),
    async loadLines() {
      ingestOdds(db, (await api.getOdds('basketball_nba')).data, cfg.preferredBooks, clock);
    },
  };
}
type App = ReturnType<typeof buildApp>;

async function signUp(app: App, name: string) {
  return signUpPlayer(app, name);
}

async function watchAd(app: App, token: string, purpose: 'points' | 'pick', competitionId?: string) {
  const start = await app.inject({ method: 'POST', url: '/ads/sessions', headers: auth(token), payload: { purpose, competitionId } });
  const sessionId = start.json().sessionId as string;
  await app.inject({ method: 'POST', url: `/ads/sessions/${sessionId}/stub-complete`, headers: auth(token) });
  return sessionId;
}

const contest = (over: Record<string, unknown> = {}) => ({
  name: 'Daily: Sat, Nov 21',
  kind: 'daily',
  prize: '$25 gift card',
  prizeDetails: 'Top score wins',
  maxEntries: 2,
  startsAt: iso(et(2026, 11, 21, 0)),
  endsAt: iso(et(2026, 11, 22, 0)),
  ...over,
});

describe('contests (admin)', () => {
  it('needs the admin password and slows down guessing', async () => {
    const { app } = setup(et(2026, 11, 20, 12));
    expect((await app.inject({ method: 'GET', url: '/admin/competitions' })).statusCode).toBe(403);
    for (let i = 0; i < 9; i++) {
      await app.inject({ method: 'GET', url: '/admin/competitions', headers: { authorization: 'Bearer wrong' } });
    }
    const locked = await app.inject({ method: 'GET', url: '/admin/competitions', headers: ADMIN });
    expect(locked.statusCode).toBe(429);
  });

  it('serves the admin page as HTML', async () => {
    const { app } = setup(et(2026, 11, 20, 12));
    const res = await app.inject({ method: 'GET', url: '/admin' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('<html');
  });

  it('offers next daily, weekly and monthly windows', async () => {
    const { app } = setup(et(2026, 11, 20, 21)); // Friday night
    const body = (await app.inject({ method: 'GET', url: '/admin/competitions', headers: ADMIN })).json();
    expect(body.presets.daily).toMatchObject({ startsAt: iso(et(2026, 11, 21, 0)), endsAt: iso(et(2026, 11, 22, 0)) });
    // Weekly: 7 days from tomorrow. Monthly: 30 days from next Monday.
    expect(body.presets.weekly).toMatchObject({ lengthDays: 7, startsAt: iso(et(2026, 11, 21, 0)), endsAt: iso(et(2026, 11, 28, 0)) });
    expect(body.presets.monthly).toMatchObject({ lengthDays: 30, startsAt: iso(et(2026, 11, 23, 0)), endsAt: iso(et(2026, 12, 23, 0)) });
  });

  it('bulk-creates a 7-day contest starting every day, and a 30-day one every Monday', async () => {
    const { app } = setup(et(2026, 11, 20, 21));
    const bulk = (payload: object) => app.inject({ method: 'POST', url: '/admin/competitions/bulk', headers: ADMIN, payload });
    const base = { prize: '$50 gift card', maxEntries: 500 };
    const weeks = await bulk({ ...base, kind: 'weekly', firstStart: iso(et(2026, 11, 21, 0)), lengthDays: 7, everyDays: 1, count: 7 });
    expect(weeks.statusCode).toBe(200);
    const w = weeks.json().created;
    expect(w).toHaveLength(7);
    expect(w[0]).toMatchObject({ name: 'Weekly: Sat, Nov 21', startsAt: iso(et(2026, 11, 21, 0)), endsAt: iso(et(2026, 11, 28, 0)) });
    expect(w[6]).toMatchObject({ name: 'Weekly: Fri, Nov 27', endsAt: iso(et(2026, 12, 4, 0)) });

    const months = await bulk({ ...base, kind: 'monthly', name: 'Monthly Madness', firstStart: iso(et(2026, 11, 23, 0)), lengthDays: 30, everyDays: 7, count: 4 });
    const m = months.json().created;
    expect(m.map((c: { name: string }) => c.name)).toEqual([
      'Monthly Madness: Mon, Nov 23',
      'Monthly Madness: Mon, Nov 30',
      'Monthly Madness: Mon, Dec 7',
      'Monthly Madness: Mon, Dec 14',
    ]);
    // Nothing is created if any would start in the past.
    expect((await bulk({ ...base, kind: 'weekly', firstStart: iso(et(2026, 11, 20, 0)), lengthDays: 7, everyDays: 1, count: 3 })).statusCode).toBe(400);
    const all = (await app.inject({ method: 'GET', url: '/admin/competitions', headers: ADMIN })).json().competitions;
    expect(all).toHaveLength(11);
  });

  it('creates contests only before they start, and locks them once they start', async () => {
    const { app, setClock } = setup(et(2026, 11, 20, 21));
    const late = await app.inject({ method: 'POST', url: '/admin/competitions', headers: ADMIN, payload: contest({ startsAt: iso(et(2026, 11, 20, 20)) }) });
    expect(late.statusCode).toBe(400);

    const made = await app.inject({ method: 'POST', url: '/admin/competitions', headers: ADMIN, payload: contest() });
    expect(made.statusCode).toBe(200);
    const id = made.json().id as string;
    expect(made.json()).toMatchObject({ status: 'upcoming', entries: 0, maxEntries: 2, prize: '$25 gift card' });

    const edited = await app.inject({ method: 'PUT', url: `/admin/competitions/${id}`, headers: ADMIN, payload: contest({ prize: '$30 gift card' }) });
    expect(edited.json().prize).toBe('$30 gift card');

    setClock(et(2026, 11, 21, 0, 1));
    const lockedEdit = await app.inject({ method: 'PUT', url: `/admin/competitions/${id}`, headers: ADMIN, payload: contest({ prize: '$5' }) });
    expect(lockedEdit.statusCode).toBe(400);
    expect((await app.inject({ method: 'DELETE', url: `/admin/competitions/${id}`, headers: ADMIN })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: `/competitions/${id}` })).json().competition).toMatchObject({ prize: '$30 gift card', status: 'live' });
  });

  it('deletes an upcoming contest', async () => {
    const { app } = setup(et(2026, 11, 20, 21));
    const id = (await app.inject({ method: 'POST', url: '/admin/competitions', headers: ADMIN, payload: contest() })).json().id;
    expect((await app.inject({ method: 'DELETE', url: `/admin/competitions/${id}`, headers: ADMIN })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/competitions/${id}` })).statusCode).toBe(404);
  });
});

describe('contests (players)', () => {
  it('joins for free up to the cap, ranks by points in the contest, and picks a winner after grading', async () => {
    const { app, db, setClock, loadLines } = setup(et(2026, 11, 20, 21));
    const id = (await app.inject({ method: 'POST', url: '/admin/competitions', headers: ADMIN, payload: contest() })).json().id as string;

    const a = await signUp(app, 'alice');
    const b = await signUp(app, 'bob');
    const c = await signUp(app, 'carol');
    const join = (token: string, cid = id) => app.inject({ method: 'POST', url: `/competitions/${cid}/join`, headers: auth(token) });

    expect((await join(a)).statusCode).toBe(200);
    expect((await join(a)).json().error).toBe('already_joined');
    expect((await join(b)).statusCode).toBe(200);
    expect((await join(c)).json().error).toBe('full');

    const list = (await app.inject({ method: 'GET', url: '/competitions', headers: auth(a) })).json().competitions;
    expect(list.find((x: { id: string }) => x.id === id)).toMatchObject({ joined: true, entries: 2, status: 'upcoming', mine: { balance: 0 } });

    setClock(et(2026, 11, 21, 12));
    await loadLines();
    await watchAd(app, a, 'points', id);
    await watchAd(app, b, 'points', id);
    const ad = await watchAd(app, a, 'pick');
    const placed = await app.inject({ method: 'POST', url: '/picks', headers: auth(a), payload: { competitionId: id, eventId: 'g1', market: 'moneyline', selection: 'home', points: 10, adSessionId: ad } });
    expect(placed.statusCode).toBe(200);

    // Can't pick a winner while the contest is running or its picks are ungraded.
    expect((await app.inject({ method: 'POST', url: `/admin/competitions/${id}/finalize`, headers: ADMIN })).statusCode).toBe(400);
    setClock(et(2026, 11, 22, 1));
    const pending = await app.inject({ method: 'POST', url: `/admin/competitions/${id}/finalize`, headers: ADMIN });
    expect(pending.json().error).toMatch(/waiting to be graded/);

    applyScores(db, [{ id: 'g1', sport_key: 'basketball_nba', commence_time: '', home_team: 'Knicks', away_team: 'Celtics', completed: true, scores: [{ name: 'Knicks', score: '110' }, { name: 'Celtics', score: '100' }] }], et(2026, 11, 22, 1));
    expect(gradeEvent(db, 'g1', et(2026, 11, 22, 1))).toBe(1);

    const detail = (await app.inject({ method: 'GET', url: `/competitions/${id}`, headers: auth(a) })).json();
    expect(detail.standings).toEqual([
      { rank: 1, displayName: 'alice', score: 16 }, // 10 at -150 pays 16
      { rank: 2, displayName: 'bob', score: 10 },
    ]);
    expect(detail.me).toEqual({ rank: 1, score: 16 });

    const done = await app.inject({ method: 'POST', url: `/admin/competitions/${id}/finalize`, headers: ADMIN });
    expect(done.json()).toMatchObject({ status: 'ended', winner: 'alice' });

    // Joining after the end is refused.
    expect((await join(c, id)).json().error).toBe('ended');
  });
});
