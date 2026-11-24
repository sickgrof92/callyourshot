import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { adEligibility } from '../src/ads.ts';
import { buildApp } from '../src/app.ts';
import {
  backfillStartingPoints,
  contestStandings,
  createCompetition,
  ensureTestContests,
  finalizeEndedContests,
  getCompetition,
} from '../src/competitions.ts';
import { openDb, type DB } from '../src/db.ts';
import { playerStats } from '../src/profiles.ts';
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
    expect(body.presets.daily).toMatchObject({ startsAt: iso(et(2026, 11, 21, 5)), endsAt: iso(et(2026, 11, 22, 5)) });
    // Weekly: 7 days from tomorrow. Monthly: 30 days from next Monday.
    expect(body.presets.weekly).toMatchObject({ lengthDays: 7, startsAt: iso(et(2026, 11, 21, 5)), endsAt: iso(et(2026, 11, 28, 5)) });
    expect(body.presets.monthly).toMatchObject({ lengthDays: 30, startsAt: iso(et(2026, 11, 23, 5)), endsAt: iso(et(2026, 12, 23, 5)) });
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

  it('emergency-deletes a live contest with its entries, picks, and points only when its exact name is typed', async () => {
    const { app, db, setClock, loadLines } = setup(et(2026, 11, 20, 21));
    const id = (await app.inject({ method: 'POST', url: '/admin/competitions', headers: ADMIN, payload: contest() })).json().id as string;
    const other = (await app.inject({ method: 'POST', url: '/admin/competitions', headers: ADMIN, payload: contest({ name: 'Keep me' }) })).json().id as string;
    const a = await signUp(app, 'alice');
    for (const cid of [id, other]) await app.inject({ method: 'POST', url: `/competitions/${cid}/join`, headers: auth(a) });

    setClock(et(2026, 11, 21, 12));
    await loadLines();
    const ad = await watchAd(app, a, 'pick');
    const placed = await app.inject({ method: 'POST', url: '/picks', headers: auth(a), payload: { competitionId: id, eventId: 'g1', market: 'moneyline', selection: 'home', points: 10, adSessionId: ad } });
    expect(placed.statusCode).toBe(200);

    const preview = await app.inject({ method: 'GET', url: `/admin/competitions/${id}/delete-preview`, headers: ADMIN });
    expect(preview.json()).toEqual({ name: 'Daily: Sat, Nov 21', entries: 1, picks: 1, claims: 0, paidClaims: 0 });

    const del = (payload?: object) => app.inject({ method: 'DELETE', url: `/admin/competitions/${id}`, headers: ADMIN, payload });
    expect((await app.inject({ method: 'DELETE', url: `/admin/competitions/${id}`, payload: { confirmName: 'Daily: Sat, Nov 21' } })).statusCode).toBe(403);
    expect((await del()).json().error).toMatch(/Emergency delete/);
    expect((await del({ confirmName: 'Daily' })).json().error).toMatch(/doesn't match/);

    const done = await del({ confirmName: '  Daily: Sat, Nov 21 ' });
    expect(done.json()).toEqual({ deleted: true });
    expect((await app.inject({ method: 'GET', url: `/competitions/${id}` })).statusCode).toBe(404);
    for (const t of ['picks', 'ledger', 'ad_sessions', 'prize_claims', 'competition_entries']) {
      expect((db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE competition_id = ?`).get(id) as { n: number }).n).toBe(0);
    }
    // The other contest and the player are untouched.
    const list = (await app.inject({ method: 'GET', url: '/competitions', headers: auth(a) })).json().competitions;
    expect(list.map((x: { id: string }) => x.id)).toEqual([other]);
    expect(list[0]).toMatchObject({ joined: true });
    expect((await app.inject({ method: 'GET', url: '/picks', headers: auth(a) })).statusCode).toBe(200);
  });

  it("won't delete a contest whose prize has been paid", async () => {
    const { app, db, setClock } = setup(et(2026, 11, 20, 21));
    const id = (await app.inject({ method: 'POST', url: '/admin/competitions', headers: ADMIN, payload: contest() })).json().id as string;
    const a = await signUp(app, 'alice');
    await app.inject({ method: 'POST', url: `/competitions/${id}/join`, headers: auth(a) });
    const uid = (db.prepare('SELECT user_id FROM competition_entries WHERE competition_id = ?').get(id) as { user_id: string }).user_id;
    db.prepare("INSERT INTO prize_claims (competition_id, user_id, status, created_at, updated_at) VALUES (?, ?, 'paid', 0, 0)").run(id, uid);
    setClock(et(2026, 11, 23, 12));
    const res = await app.inject({ method: 'DELETE', url: `/admin/competitions/${id}`, headers: ADMIN, payload: { confirmName: 'Daily: Sat, Nov 21' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/already been paid/);
    expect((await app.inject({ method: 'GET', url: `/competitions/${id}` })).statusCode).toBe(200);
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
    expect(list.find((x: { id: string }) => x.id === id)).toMatchObject({ joined: true, entries: 2, status: 'upcoming', mine: { balance: 10 } });

    setClock(et(2026, 11, 21, 12));
    await loadLines();
    const ad = await watchAd(app, a, 'pick');
    const placed = await app.inject({ method: 'POST', url: '/picks', headers: auth(a), payload: { competitionId: id, eventId: 'g1', market: 'moneyline', selection: 'home', points: 10, adSessionId: ad } });
    expect(placed.statusCode).toBe(200);

    // Can't pick a winner while the contest is running or its picks are ungraded.
    expect((await app.inject({ method: 'POST', url: `/admin/competitions/${id}/finalize`, headers: ADMIN })).statusCode).toBe(400);
    setClock(et(2026, 11, 22, 1));
    const pending = await app.inject({ method: 'POST', url: `/admin/competitions/${id}/finalize`, headers: ADMIN });
    expect(pending.json().error).toMatch(/waiting to be graded/);
    // The automatic pass also waits for grading.
    expect(finalizeEndedContests(db, et(2026, 11, 22, 1))).toEqual([]);

    applyScores(db, [{ id: 'g1', sport_key: 'basketball_nba', commence_time: '', home_team: 'Knicks', away_team: 'Celtics', completed: true, scores: [{ name: 'Knicks', score: '110' }, { name: 'Celtics', score: '100' }] }], et(2026, 11, 22, 1));
    expect(gradeEvent(db, 'g1', et(2026, 11, 22, 1))).toBe(1);

    const detail = (await app.inject({ method: 'GET', url: `/competitions/${id}`, headers: auth(a) })).json();
    expect(detail.standings).toEqual([
      { rank: 1, displayName: 'alice', score: 16.66 }, // 10 at -150 pays 16.66
      { rank: 2, displayName: 'bob', score: 10 },
    ]);
    expect(detail.me).toEqual({ rank: 1, score: 16.66 });

    // The admin can open a player from the standings and see their details and picks there.
    const st = (await app.inject({ method: 'GET', url: `/admin/competitions/${id}/standings`, headers: ADMIN })).json().standings;
    const aliceId = st[0].userId as string;
    expect(st[0].displayName).toBe('alice');
    expect((await app.inject({ method: 'GET', url: `/admin/competitions/${id}/players/${aliceId}` })).statusCode).toBe(403);
    const pl = (await app.inject({ method: 'GET', url: `/admin/competitions/${id}/players/${aliceId}`, headers: ADMIN })).json();
    expect(pl.player).toMatchObject({ displayName: 'alice' });
    expect(pl.entry).toMatchObject({ balance: 16.66 });
    expect(pl.entry.pointsVideos).toHaveLength(0); // the starting points came with joining
    expect(pl.picks).toHaveLength(1);
    expect(pl.picks[0]).toMatchObject({ market: 'moneyline', selection: 'home', points: 10, status: 'won', payout: 16.66 });

    // Once everything is graded, the scheduler picks the winner on its own.
    expect(finalizeEndedContests(db, et(2026, 11, 22, 1)).map((x) => x.id)).toEqual([id]);
    expect(finalizeEndedContests(db, et(2026, 11, 22, 2))).toEqual([]);
    const done = await app.inject({ method: 'POST', url: `/admin/competitions/${id}/finalize`, headers: ADMIN });
    expect(done.json()).toMatchObject({ status: 'ended', winner: 'alice' });

    // Joining after the end is refused.
    expect((await join(c, id)).json().error).toBe('ended');
  });

  it('lists ended contests, newest first, and only the ones I entered when asked', async () => {
    const { app, setClock } = setup(et(2026, 11, 18, 21));
    const make = async (name: string, day: number) =>
      (await app.inject({ method: 'POST', url: '/admin/competitions', headers: ADMIN, payload: contest({ name, startsAt: iso(et(2026, 11, day, 0)), endsAt: iso(et(2026, 11, day + 1, 0)) }) })).json().id as string;
    const older = await make('Older', 19);
    const newer = await make('Newer', 20);
    const later = await make('Still to come', 25);
    const a = await signUp(app, 'alice');
    await app.inject({ method: 'POST', url: `/competitions/${older}/join`, headers: auth(a) });
    await app.inject({ method: 'POST', url: `/competitions/${later}/join`, headers: auth(a) });
    setClock(et(2026, 11, 22, 12));
    const ids = async (qs: string) =>
      ((await app.inject({ method: 'GET', url: `/competitions?${qs}`, headers: auth(a) })).json().competitions as { id: string }[]).map((c) => c.id);
    expect(await ids('status=ended')).toEqual([newer, older]);
    expect(await ids('status=ended&entered=1')).toEqual([older]);
    expect(await ids('entered=1')).toEqual([later]);
    expect(await ids('status=open')).toEqual([later]);
  });

  it('makes a week-long and a daily all-sport test contest, once each', () => {
    const db = testDb();
    const cfg = testConfig();
    const now = et(2026, 11, 18, 8) + 18 * 60_000; // 8:18 AM ET
    const made = ensureTestContests(db, cfg, now);
    expect(made).toHaveLength(2);
    expect(made[0]).toMatchObject({ name: 'Test week: all sports', kind: 'weekly', sport: null, starts_at: now + 60_000, ends_at: et(2026, 11, 25, 5) });
    // Today's daily opens at 8:30 AM ET and ends at 5 AM ET tomorrow.
    expect(made[1]).toMatchObject({ kind: 'daily', sport: null, starts_at: et(2026, 11, 18, 8) + 30 * 60_000, ends_at: et(2026, 11, 19, 5) });
    expect(made[1].name).toMatch(/^Test day: Wed, Nov 18$/);
    expect(ensureTestContests(db, cfg, now + 1000)).toHaveLength(0);
    // Past 8:30, the next day's daily opens a minute out.
    const later = et(2026, 11, 19, 9);
    const next = ensureTestContests(db, cfg, later);
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ kind: 'daily', starts_at: later + 60_000, ends_at: et(2026, 11, 20, 5) });
  });
});

describe('starting points on joining', () => {
  const window = { name: 'W', kind: 'weekly' as const, prize: 'p', prizeDetails: '', maxEntries: 9 };
  /** A contest entry made the old way: joined at 0, optionally with the old starting points video. */
  function legacyEntry(db: DB, cid: string, uid: string, o: { video?: boolean } = {}) {
    db.prepare('INSERT OR IGNORE INTO users (id, display_name, token_hash, created_at) VALUES (?, ?, ?, 0)').run(uid, uid, `h${uid}`);
    db.prepare('INSERT INTO competition_entries (competition_id, user_id, joined_at, balance) VALUES (?, ?, 0, ?)').run(cid, uid, o.video ? 10 : 0);
    if (o.video) {
      db.prepare("INSERT INTO ad_sessions (id, user_id, purpose, competition_id, created_at, rewarded_at) VALUES (?, ?, 'points', ?, 0, ?)").run(`s-${uid}-${cid}`, uid, cid, et(2026, 11, 21, 8));
      db.prepare("INSERT INTO ledger (user_id, competition_id, kind, amount, created_at) VALUES (?, ?, 'ad_reward', 10, 0)").run(uid, cid);
    }
  }

  it('credits existing players who never got their starting points, once, and leaves everyone else alone', () => {
    const db = testDb();
    const cfg = testConfig();
    const now = et(2026, 11, 21, 12);
    const mk = (startsAt: number, endsAt: number) => {
      const r = createCompetition(db, { ...window, startsAt, endsAt }, et(2026, 11, 1, 0));
      if (!r.ok) throw new Error(r.error);
      return r.value.id;
    };
    const live = mk(et(2026, 11, 21, 0), et(2026, 11, 28, 0));
    const ended = mk(et(2026, 11, 10, 0), et(2026, 11, 17, 0));
    legacyEntry(db, live, 'never'); // joined, never watched the old video
    legacyEntry(db, live, 'watched', { video: true }); // got them from the old video
    legacyEntry(db, ended, 'never');

    expect(backfillStartingPoints(db, now)).toBe(1);
    expect(backfillStartingPoints(db, now)).toBe(0); // safe to run at every startup
    const bal = (cid: string, uid: string) => (db.prepare('SELECT balance FROM competition_entries WHERE competition_id = ? AND user_id = ?').get(cid, uid) as { balance: number }).balance;
    expect(bal(live, 'never')).toBe(10);
    expect(bal(live, 'watched')).toBe(10);
    expect(bal(ended, 'never')).toBe(0); // finished contests are not changed
    expect(adEligibility(db, cfg, 'never', live, now)).toMatchObject({ hasStartingPoints: true, pointsAdsToday: 0, canEarnPoints: false });

    // The old starting points video still isn't a refill: 5 refills are left today, and it doesn't count in the tiebreaker.
    db.prepare('UPDATE competition_entries SET balance = 0').run();
    expect(adEligibility(db, cfg, 'watched', live, now)).toMatchObject({ hasStartingPoints: true, pointsAdsToday: 0, canEarnPoints: true });
    expect(contestStandings(db, getCompetition(db, live)!).find((r) => r.userId === 'watched')).toMatchObject({ refills: 0 });
    expect(playerStats(db, 'watched')).toMatchObject({ reloads: 0 });
  });

  it('counts every points video as a refill for players who got their starting points on joining', async () => {
    const db = testDb();
    const cfg = testConfig();
    const now = et(2026, 11, 21, 12);
    const app = buildApp({ db, cfg, clock: () => now });
    const r = createCompetition(db, { ...window, startsAt: et(2026, 11, 21, 0), endsAt: et(2026, 11, 28, 0) }, et(2026, 11, 1, 0));
    if (!r.ok) throw new Error(r.error);
    const token = await signUpPlayer(app, 'newbie');
    expect((await app.inject({ method: 'POST', url: `/competitions/${r.value.id}/join`, headers: auth(token) })).statusCode).toBe(200);
    const uid = (await app.inject({ method: 'GET', url: '/me', headers: auth(token) })).json().id as string;
    expect(db.prepare("SELECT kind, amount FROM ledger WHERE user_id = ?").all(uid)).toEqual([{ kind: 'join_bonus', amount: 10 }]);
    // A backfill later doesn't pay again.
    expect(backfillStartingPoints(db, now)).toBe(0);

    db.prepare('UPDATE competition_entries SET balance = 0').run();
    const start = await app.inject({ method: 'POST', url: '/ads/sessions', headers: auth(token), payload: { purpose: 'points', competitionId: r.value.id } });
    await app.inject({ method: 'POST', url: `/ads/sessions/${start.json().sessionId}/stub-complete`, headers: auth(token) });
    expect(adEligibility(db, cfg, uid, r.value.id, now)).toMatchObject({ balance: 10, pointsAdsToday: 1 });
    expect(contestStandings(db, getCompetition(db, r.value.id)!)[0]).toMatchObject({ refills: 1 });
    expect(playerStats(db, 'newbie')).toMatchObject({ reloads: 1 });
  });

  it('upgrades an existing database so it can record starting points, keeping every ledger row', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'cys-')), 'db.sqlite');
    let db = openDb(path);
    // Put the ledger back the way it was before join_bonus existed.
    db.exec(`DROP TABLE ledger; CREATE TABLE ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL REFERENCES users(id), competition_id TEXT NOT NULL REFERENCES competitions(id),
      kind TEXT NOT NULL CHECK (kind IN ('ad_reward','pick_stake','pick_won','pick_push','pick_lost','pick_void')),
      amount INTEGER NOT NULL, ref TEXT, created_at INTEGER NOT NULL)`);
    const r = createCompetition(db, { ...window, startsAt: et(2026, 11, 21, 0), endsAt: et(2026, 11, 28, 0) }, et(2026, 11, 1, 0));
    if (!r.ok) throw new Error(r.error);
    legacyEntry(db, r.value.id, 'old', { video: true });
    db.close();

    db = openDb(path);
    expect(db.prepare('SELECT kind, amount FROM ledger').all()).toEqual([{ kind: 'ad_reward', amount: 10 }]);
    legacyEntry(db, r.value.id, 'new');
    expect(backfillStartingPoints(db, et(2026, 11, 21, 12))).toBe(1);
    expect(db.prepare("SELECT user_id FROM ledger WHERE kind = 'join_bonus'").all()).toEqual([{ user_id: 'new' }]);
    db.close();
  });
});
