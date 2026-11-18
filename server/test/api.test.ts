import { generateKeyPairSync, createSign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyAdmobSsv } from '../src/ads.ts';
import { buildApp } from '../src/app.ts';
import { createCompetition } from '../src/competitions.ts';
import { LEDGER_KINDS } from '../src/db.ts';
import { gradeEvent, voidPostponed } from '../src/grading.ts';
import { applyScores, ingestOdds } from '../src/lines.ts';
import { et, FakeOddsApi, testConfig, testDb, type FakeGame } from './helpers.ts';
import { seedPlayer, signUpPlayer, TEST_CONTEST } from './helpers.ts';

const MIN = 60_000;

function setup(now: number, cfgOver = {}) {
  const db = testDb();
  const cfg = testConfig(cfgOver);
  let clock = now;
  const app = buildApp({ db, cfg, clock: () => clock });
  const games: FakeGame[] = [
    { id: 'g1', sport: 'basketball_nba', start: et(2026, 11, 21, 19), home: 'Knicks', away: 'Celtics', homeScore: 110, awayScore: 100 },
  ];
  const api = new FakeOddsApi(games, () => clock);
  // A week-long contest that is live for every test below.
  const contest = createCompetition(
    db,
    { name: 'Weekly', kind: 'weekly', prize: '$50 gift card', prizeDetails: '', maxEntries: 100, startsAt: et(2026, 11, 21, 0), endsAt: et(2026, 11, 28, 0) },
    et(2026, 11, 20, 0),
  );
  if (!contest.ok) throw new Error(contest.error);
  const cid = contest.value.id;
  return {
    cid,
    db,
    cfg,
    app,
    api,
    games,
    setClock: (t: number) => (clock = t),
    async loadLines() {
      ingestOdds(db, (await api.getOdds('basketball_nba')).data, cfg.preferredBooks, clock);
    },
  };
}

/** Sign up and join contest `cid`. */
async function signUp(app: ReturnType<typeof buildApp>, name: string, cid?: string) {
  const token = await signUpPlayer(app, name);
  if (cid) expect((await app.inject({ method: 'POST', url: `/competitions/${cid}/join`, headers: auth(token) })).statusCode).toBe(200);
  return token;
}

type App = ReturnType<typeof buildApp>;
const auth = (token: string) => ({ authorization: `Bearer ${token}` });

/** Start and complete (stub) an ad of the given purpose. Returns the HTTP results. */
async function watchAd(app: App, token: string, purpose: 'points' | 'pick' | 'forfeit', competitionId?: string) {
  const start = await app.inject({ method: 'POST', url: '/ads/sessions', headers: auth(token), payload: { purpose, competitionId } });
  if (start.statusCode !== 200) return { start, sessionId: null as string | null };
  const sessionId = start.json().sessionId as string;
  const done = await app.inject({ method: 'POST', url: `/ads/sessions/${sessionId}/stub-complete`, headers: auth(token) });
  expect(done.statusCode).toBe(200);
  return { start, sessionId };
}

/** My state in a contest: balance, picks in play, refills. */
async function mine(app: App, token: string, cid: string) {
  return (await app.inject({ method: 'GET', url: `/competitions/${cid}`, headers: auth(token) })).json().competition.mine;
}

async function pick(app: App, token: string, payload: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: '/picks', headers: auth(token), payload });
}

describe('end-to-end', () => {
  it('starts each contest at 0, needs an ad for every pick, refills only when out, locks at start, grades and ranks', async () => {
    const t0 = et(2026, 11, 21, 12);
    const { app, db, cid, loadLines, setClock } = setup(t0);
    await loadLines();
    const a = await signUp(app, 'alice', cid);
    const b = await signUp(app, 'bob', cid);

    // Everyone starts the contest at 0 and watches a video for their first 10 points.
    expect(await mine(app, a, cid)).toMatchObject({ balance: 0, canEarnPoints: true, pointsAdsToday: 0, pointsAdsPerDay: 5 });
    expect((await watchAd(app, a, 'points')).start.json().error).toBe('contest_required');
    await watchAd(app, a, 'points', cid);
    // Can't watch for more points while you still have points.
    expect((await watchAd(app, a, 'points', cid)).start.json().error).toBe('not_out_of_points');
    await watchAd(app, b, 'points', cid);
    // The starting points are not a refill.
    expect(await mine(app, a, cid)).toMatchObject({ balance: 10, canEarnPoints: false, pointsAdsToday: 0, hasStartingPoints: true });

    const lines = (await app.inject({ method: 'GET', url: '/lines?sport=basketball_nba' })).json();
    expect(lines.events[0].lines.spread.home).toEqual({ point: -3.5, price: -110, payout: 1.91 });

    const p = (x: Record<string, unknown>) => ({ competitionId: cid, eventId: 'g1', ...x });
    // No ad, no pick.
    const noAd = await pick(app, a, p({ market: 'spread', selection: 'home', points: 10 }));
    expect(noAd.statusCode).toBe(403);
    expect(noAd.json().error).toBe('pick_ad_required');
    // Watching a pick ad gives no points.
    const ad1 = (await watchAd(app, a, 'pick')).sessionId!;
    expect((await mine(app, a, cid)).balance).toBe(10);

    // A moved line doesn't use up the ad.
    const moved = await pick(app, a, p({ market: 'spread', selection: 'home', points: 10, expectedPoint: -2.5, expectedPrice: -110, adSessionId: ad1 }));
    expect(moved.json().error).toBe('line_moved');
    const ok = await pick(app, a, p({ market: 'spread', selection: 'home', points: 10, expectedPoint: -3.5, expectedPrice: -110, adSessionId: ad1 }));
    expect(ok.statusCode).toBe(200);
    expect(ok.json().balance).toBe(0);

    // One ad, one pick.
    expect((await pick(app, a, p({ market: 'moneyline', selection: 'home', points: 10, adSessionId: ad1 }))).json().error).toBe('pick_ad_required');
    // Someone else's ad doesn't work either.
    const bobsAd = (await watchAd(app, b, 'pick')).sessionId!;
    expect((await pick(app, a, p({ market: 'moneyline', selection: 'home', points: 10, adSessionId: bobsAd }))).json().error).toBe('pick_ad_required');

    // At 0 but with a pick still in play: no points video until it's graded (or forfeited).
    expect(await mine(app, a, cid)).toMatchObject({ balance: 0, picksInPlay: 1, canEarnPoints: false });
    expect((await watchAd(app, a, 'points', cid)).start.json().error).toBe('points_in_play');

    // Locks exactly at the scheduled start, without any API call.
    setClock(et(2026, 11, 21, 19) - 1);
    // Pick ads expire after 30 minutes, so Bob watches a fresh one.
    expect((await pick(app, b, p({ market: 'total', selection: 'under', points: 10, adSessionId: bobsAd }))).json().error).toBe('pick_ad_required');
    const bobsFreshAd = (await watchAd(app, b, 'pick')).sessionId!;
    expect((await pick(app, b, p({ market: 'total', selection: 'under', points: 10, adSessionId: bobsFreshAd }))).statusCode).toBe(200);
    setClock(et(2026, 11, 21, 19));
    const lateAd = (await watchAd(app, a, 'pick')).sessionId!;
    expect((await pick(app, a, p({ market: 'moneyline', selection: 'home', points: 10, adSessionId: lateAd }))).json().error).toBe('locked');

    // In play, both still count their 10 points on the board.
    let board = (await app.inject({ method: 'GET', url: `/competitions/${cid}`, headers: auth(b) })).json();
    expect(board.standings.map((s: { score: number }) => s.score)).toEqual([10, 10]);

    // Final: Knicks 110-100. Alice (home -3.5) wins, Bob (under 44.5) loses.
    const end = et(2026, 11, 21, 22);
    setClock(end);
    applyScores(db, [{ id: 'g1', sport_key: 'basketball_nba', commence_time: '', home_team: 'Knicks', away_team: 'Celtics', completed: true, scores: [{ name: 'Knicks', score: '110' }, { name: 'Celtics', score: '100' }] }], end);
    expect(gradeEvent(db, 'g1', end)).toBe(2);

    expect((await mine(app, a, cid)).balance).toBe(19); // 10 at -110 pays 19
    board = (await app.inject({ method: 'GET', url: `/competitions/${cid}`, headers: auth(b) })).json();
    expect(board.standings.map((s: { displayName: string; score: number }) => [s.displayName, s.score])).toEqual([['alice', 19], ['bob', 0]]);
    expect(board.me).toEqual({ score: 0, rank: 2 });
    // Bob is out with nothing in play, so he can watch for points again.
    expect((await mine(app, b, cid)).canEarnPoints).toBe(true);
  });

  it('keeps every contest separate: its own balance, refills and picks', async () => {
    const { app, db, cid, loadLines } = setup(et(2026, 11, 21, 12));
    await loadLines();
    const other = createCompetition(
      db,
      { name: 'Monthly', kind: 'monthly', prize: '$100', prizeDetails: '', maxEntries: 100, startsAt: et(2026, 11, 21, 6), endsAt: et(2026, 12, 21, 6) },
      et(2026, 11, 21, 5),
    );
    if (!other.ok) throw new Error(other.error);
    const oid = other.value.id;
    const a = await signUp(app, 'alice', cid);

    // Not joined yet: no points or picks there.
    expect((await watchAd(app, a, 'points', oid)).start.json().error).toBe('not_joined');
    await app.inject({ method: 'POST', url: `/competitions/${oid}/join`, headers: auth(a) });

    await watchAd(app, a, 'points', cid);
    // Being out of points elsewhere is what counts: the new contest still starts at 0.
    expect(await mine(app, a, oid)).toMatchObject({ balance: 0, canEarnPoints: true, pointsAdsToday: 0 });
    await watchAd(app, a, 'points', oid);

    // The same game can be picked once in each contest, each with its own ad.
    const ad1 = (await watchAd(app, a, 'pick')).sessionId!;
    expect((await pick(app, a, { competitionId: cid, eventId: 'g1', market: 'moneyline', selection: 'home', points: 10, adSessionId: ad1 })).statusCode).toBe(200);
    const ad2 = (await watchAd(app, a, 'pick')).sessionId!;
    expect((await pick(app, a, { competitionId: cid, eventId: 'g1', market: 'moneyline', selection: 'away', points: 10, adSessionId: ad2 })).json().error).toBe('already_picked');
    expect((await pick(app, a, { competitionId: oid, eventId: 'g1', market: 'moneyline', selection: 'away', points: 10, adSessionId: ad2 })).statusCode).toBe(200);

    expect((await mine(app, a, cid)).balance).toBe(0);
    expect((await mine(app, a, oid)).balance).toBe(0);
    const picks = (await app.inject({ method: 'GET', url: `/picks?competitionId=${oid}`, headers: auth(a) })).json().picks;
    expect(picks).toHaveLength(1);
    expect(picks[0]).toMatchObject({ selection: 'away', competition_name: 'Monthly' });
  });

  it('only allows picks while the contest is live, on games expected to finish before it ends', async () => {
    const { app, db, loadLines } = setup(et(2026, 11, 20, 12));
    await loadLines();
    const mk = (startsAt: number, endsAt: number) => {
      const r = createCompetition(db, { name: 'X', kind: 'daily', prize: 'p', prizeDetails: '', maxEntries: 9, startsAt, endsAt }, et(2026, 11, 20, 0));
      if (!r.ok) throw new Error(r.error);
      return r.value.id;
    };
    const tomorrow = mk(et(2026, 11, 21, 0), et(2026, 11, 22, 0));
    const endsEarly = mk(et(2026, 11, 20, 6), et(2026, 11, 21, 18)); // ends before the 7 PM game on the 21st
    // Starts before the 7 PM tip, but an NBA game (plus a buffer) isn't expected to be over by 9:30 PM.
    const endsMidGame = mk(et(2026, 11, 20, 6), et(2026, 11, 21, 21) + 30 * MIN);
    const endsAt5am = mk(et(2026, 11, 20, 6), et(2026, 11, 22, 5));
    const a = await signUp(app, 'alice', tomorrow);
    for (const id of [endsEarly, endsMidGame, endsAt5am]) await app.inject({ method: 'POST', url: `/competitions/${id}/join`, headers: auth(a) });
    await watchAd(app, a, 'points', endsMidGame);
    await watchAd(app, a, 'points', endsAt5am);
    const ad1 = (await watchAd(app, a, 'pick')).sessionId!;
    expect((await pick(app, a, { competitionId: endsMidGame, eventId: 'g1', market: 'moneyline', selection: 'home', points: 10, adSessionId: ad1 })).json().error).toBe('after_contest_end');
    expect((await pick(app, a, { competitionId: endsAt5am, eventId: 'g1', market: 'moneyline', selection: 'home', points: 10, adSessionId: ad1 })).statusCode).toBe(200);
    expect((await watchAd(app, a, 'points', tomorrow)).start.json().error).toBe('contest_not_live');
    await watchAd(app, a, 'points', endsEarly);
    const ad = (await watchAd(app, a, 'pick')).sessionId!;
    expect((await pick(app, a, { competitionId: tomorrow, eventId: 'g1', market: 'moneyline', selection: 'home', points: 10, adSessionId: ad })).json().error).toBe('contest_not_live');
    expect((await pick(app, a, { competitionId: endsEarly, eventId: 'g1', market: 'moneyline', selection: 'home', points: 10, adSessionId: ad })).json().error).toBe('after_contest_end');
  });

  it('refunds picks as soon as the schedule shows a game postponed or cancelled', async () => {
    const { app, db, cid, games, loadLines } = setup(et(2026, 11, 21, 12));
    games.push({ id: 'g2', sport: 'basketball_nba', start: et(2026, 11, 21, 20), home: 'Nets', away: 'Bulls', homeScore: 0, awayScore: 0 });
    games.push({ id: 'g3', sport: 'basketball_nba', start: et(2026, 11, 21, 21), home: 'Heat', away: 'Magic', homeScore: 0, awayScore: 0 });
    await loadLines();
    for (const eventId of ['g1', 'g2', 'g3']) {
      const a = await signUp(app, `player_${eventId}`, cid);
      await watchAd(app, a, 'points', cid);
      const ad = (await watchAd(app, a, 'pick')).sessionId!;
      expect((await pick(app, a, { competitionId: cid, eventId, market: 'moneyline', selection: 'home', points: 10, adSessionId: ad })).statusCode).toBe(200);
    }
    const status = () => Object.fromEntries((db.prepare('SELECT event_id, status FROM picks').all() as { event_id: string; status: string }[]).map((r) => [r.event_id, r.status]));
    const iso = (t: number) => new Date(t).toISOString();
    // g1 is moved 10 minutes (still on), g2 is pushed to tomorrow (postponed), g3 drops off the schedule (cancelled).
    const n = voidPostponed(db, 'basketball_nba', [
      { id: 'g1', commence_time: iso(et(2026, 11, 21, 19) + 10 * MIN) },
      { id: 'g2', commence_time: iso(et(2026, 11, 22, 19)) },
    ], et(2026, 11, 21, 13));
    expect(n).toBe(2);
    expect(status()).toEqual({ g1: 'pending', g2: 'void', g3: 'void' });
    // The cancelled game is hidden from Games; the postponed one stays listed.
    const listed = (await app.inject({ method: 'GET', url: '/lines?sport=basketball_nba' })).json().events.map((e: { id: string }) => e.id);
    expect(listed).not.toContain('g3');
    // An empty schedule (a glitch) refunds nothing.
    expect(voidPostponed(db, 'basketball_nba', [], et(2026, 11, 21, 13))).toBe(0);
  });

  it('changes a pick before game time with an ad, with no loss, and locks changes at the start', async () => {
    const { app, db, cid, loadLines, setClock } = setup(et(2026, 11, 21, 12));
    await loadLines();
    const a = await signUp(app, 'chris', cid);
    await watchAd(app, a, 'points', cid);
    const ad1 = (await watchAd(app, a, 'pick')).sessionId!;
    const made = await pick(app, a, { competitionId: cid, eventId: 'g1', market: 'moneyline', selection: 'home', points: 10, adSessionId: ad1 });
    expect(made.statusCode).toBe(200);
    const pickId = made.json().pickId as string;
    const change = (body: object) => app.inject({ method: 'POST', url: `/picks/${pickId}/change`, headers: auth(a), payload: body });

    // An ad is required.
    expect((await change({ market: 'spread', selection: 'away', points: 10 })).json().error).toBe('pick_ad_required');
    // Switch to the spread, other side. Not a forfeit: the pick stays pending and no points are lost.
    const ad2 = (await watchAd(app, a, 'pick')).sessionId!;
    const r = await change({ market: 'spread', selection: 'away', points: 10, adSessionId: ad2 });
    expect(r.statusCode).toBe(200);
    expect(r.json().balance).toBe(0);
    const row = db.prepare('SELECT market, selection, stake, status, forfeited_at FROM picks WHERE id = ?').get(pickId);
    expect(row).toMatchObject({ market: 'spread', selection: 'away', stake: 10, status: 'pending', forfeited_at: null });
    expect((db.prepare('SELECT COUNT(*) AS n FROM picks').get() as { n: number }).n).toBe(1);

    // Can't put in more points than the player has.
    const ad3 = (await watchAd(app, a, 'pick')).sessionId!;
    expect((await change({ market: 'spread', selection: 'away', points: 20, adSessionId: ad3 })).json().error).toBe('not_enough_points');

    // Locked once the game starts.
    setClock(et(2026, 11, 21, 19));
    expect((await change({ market: 'moneyline', selection: 'away', points: 10, adSessionId: ad3 })).json().error).toBe('locked');
  });

  it('refills only at exactly 0 points, and takes picks of any amount from 1 point', async () => {
    const { app, db, cid, loadLines } = setup(et(2026, 11, 21, 12));
    await loadLines();
    const a = await signUp(app, 'dana', cid);
    await watchAd(app, a, 'points', cid);
    const uid = (db.prepare("SELECT id FROM users WHERE display_name = 'dana'").get() as { id: string }).id;
    db.prepare('UPDATE competition_entries SET balance = 5 WHERE competition_id = ? AND user_id = ?').run(cid, uid);
    expect((await mine(app, a, cid)).canEarnPoints).toBe(false);
    expect((await app.inject({ method: 'POST', url: '/ads/sessions', headers: auth(a), payload: { purpose: 'points', competitionId: cid } })).json().error).toBe(
      'not_out_of_points',
    );
    const ad = (await watchAd(app, a, 'pick')).sessionId!;
    // Any whole number of points from 1 up works.
    expect((await pick(app, a, { competitionId: cid, eventId: 'g1', market: 'moneyline', selection: 'home', points: 0, adSessionId: ad })).json().error).toBe('bad_amount');
    expect((await pick(app, a, { competitionId: cid, eventId: 'g1', market: 'moneyline', selection: 'home', points: 4, adSessionId: ad })).statusCode).toBe(200);
  });

  it('lets the admin load a sport\'s lines right away', async () => {
    const db = testDb();
    const cfg = testConfig();
    const now = et(2026, 11, 21, 9);
    const api = new FakeOddsApi(
      [{ id: 'n1', sport: 'basketball_nba', start: et(2026, 11, 21, 19), home: 'Knicks', away: 'Celtics', homeScore: 0, awayScore: 0 }],
      () => now,
    );
    const app = buildApp({ db, cfg, clock: () => now, oddsApi: api });
    const ADMIN = { authorization: `Bearer ${cfg.adminToken}` };
    expect((await app.inject({ method: 'POST', url: '/admin/lines/refresh', payload: { sport: 'basketball_nba' } })).statusCode).toBe(403);
    const r = await app.inject({ method: 'POST', url: '/admin/lines/refresh', headers: ADMIN, payload: { sport: 'basketball_nba' } });
    expect(r.json()).toMatchObject({ ok: true, games: 1, withLines: 1 });
    const lines = (await app.inject({ method: 'GET', url: '/lines?sport=basketball_nba' })).json().events;
    expect(Object.keys(lines[0].lines)).toEqual(expect.arrayContaining(['moneyline', 'spread', 'total']));
    expect((await app.inject({ method: 'POST', url: '/admin/lines/refresh', headers: ADMIN, payload: { sport: 'curling' } })).json().error).toBe('Unknown sport.');
    // Without an Odds API key, the button explains why it can't.
    const noKey = buildApp({ db, cfg, clock: () => now });
    expect((await noKey.inject({ method: 'POST', url: '/admin/lines/refresh', headers: ADMIN, payload: { sport: 'basketball_nba' } })).statusCode).toBe(503);
  });

  it('forfeits a pick as a loss after an ad, only once the game has started, so the player can refill again', async () => {
    const { app, db, cid, loadLines, setClock } = setup(et(2026, 11, 21, 12));
    await loadLines();
    const e = await signUp(app, 'erin', cid);
    await watchAd(app, e, 'points', cid);
    const ad = (await watchAd(app, e, 'pick')).sessionId!;
    const placed = await pick(app, e, { competitionId: cid, eventId: 'g1', market: 'spread', selection: 'away', points: 10, adSessionId: ad });
    const pickId = placed.json().pickId as string;

    expect((await watchAd(app, e, 'points', cid)).start.json().error).toBe('points_in_play');

    const forfeit = (body: Record<string, unknown>) =>
      app.inject({ method: 'POST', url: `/picks/${pickId}/forfeit`, headers: auth(e), payload: body });
    setClock(et(2026, 11, 21, 18, 50));
    const early = (await watchAd(app, e, 'forfeit')).sessionId!;
    expect((await forfeit({ adSessionId: early })).json().error).toBe('not_started');

    setClock(et(2026, 11, 21, 20));
    expect((await forfeit({})).json().error).toBe('forfeit_ad_required');
    const pickAdId = (await watchAd(app, e, 'pick')).sessionId!; // wrong kind of ad
    expect((await forfeit({ adSessionId: pickAdId })).json().error).toBe('forfeit_ad_required');
    const fad = (await watchAd(app, e, 'forfeit')).sessionId!;
    const done = await forfeit({ adSessionId: fad });
    expect(done.statusCode).toBe(200);
    expect(done.json().balance).toBe(0); // nothing refunded
    expect((await forfeit({ adSessionId: fad })).json().error).toBe('not_pending');

    const row = db.prepare('SELECT status, payout, forfeited_at FROM picks WHERE id = ?').get(pickId) as { status: string; payout: number; forfeited_at: number };
    expect(row).toMatchObject({ status: 'lost', payout: 0 });
    expect(row.forfeited_at).not.toBeNull();
    expect(await mine(app, e, cid)).toMatchObject({ balance: 0, canEarnPoints: true, picksInPlay: 0 });

    // Grading later doesn't touch the forfeited pick.
    applyScores(db, [{ id: 'g1', sport_key: 'basketball_nba', commence_time: '', home_team: 'Knicks', away_team: 'Celtics', completed: true, scores: [{ name: 'Knicks', score: '90' }, { name: 'Celtics', score: '100' }] }], et(2026, 11, 21, 22));
    expect(gradeEvent(db, 'g1', et(2026, 11, 21, 22))).toBe(0);
    expect((await watchAd(app, e, 'points', cid)).sessionId).not.toBeNull();
  });

  it('allows the starting points plus at most 5 refills a day per contest, only while out of points', async () => {
    const { app, db, cid, setClock } = setup(et(2026, 11, 21, 12));
    const c = await signUp(app, 'carol', cid);
    const spendAll = () => db.prepare('UPDATE competition_entries SET balance = 0 WHERE competition_id = ?').run(cid);
    // The starting points, then 5 refills.
    for (let i = 0; i < 6; i++) {
      spendAll();
      expect((await watchAd(app, c, 'points', cid)).sessionId).not.toBeNull();
    }
    spendAll();
    expect((await watchAd(app, c, 'points', cid)).start.json().error).toBe('daily_limit');
    // A new day (after 5 AM Eastern) resets the count.
    setClock(et(2026, 11, 22, 6));
    expect((await watchAd(app, c, 'points', cid)).sessionId).not.toBeNull();
  });

  it('does not pay twice if two points videos were started at once', async () => {
    const { app, cid } = setup(et(2026, 11, 21, 12));
    const d = await signUp(app, 'dana', cid);
    const start = () => app.inject({ method: 'POST', url: '/ads/sessions', headers: auth(d), payload: { purpose: 'points', competitionId: cid } });
    const s1 = (await start()).json().sessionId;
    const s2 = (await start()).json().sessionId;
    expect((await app.inject({ method: 'POST', url: `/ads/sessions/${s1}/stub-complete`, headers: auth(d) })).statusCode).toBe(200);
    const second = await app.inject({ method: 'POST', url: `/ads/sessions/${s2}/stub-complete`, headers: auth(d) });
    expect(second.json().error).toBe('not_out_of_points');
    expect((await mine(app, d, cid)).balance).toBe(10);
  });
});

describe('no paid or transferable points', () => {
  it('has no ledger kind for buying, transferring or cashing out', () => {
    expect([...LEDGER_KINDS]).toEqual(['ad_reward', 'pick_stake', 'pick_won', 'pick_push', 'pick_lost', 'pick_void']);
    const db = testDb();
    seedPlayer(db, 'u', 0, 0);
    expect(() =>
      db.prepare(`INSERT INTO ledger (user_id, competition_id, kind, amount, created_at) VALUES ('u', '${TEST_CONTEST}', 'purchase', 100, 0)`).run(),
    ).toThrow();
  });

  it('exposes no purchase, transfer or cash-out routes', async () => {
    const { app } = setup(Date.now());
    await app.ready();
    const routes = app.printRoutes({ commonPrefix: false }).toLowerCase();
    for (const word of ['purchase', 'buy', 'transfer', 'gift', 'cashout', 'cash-out', 'withdraw', 'redeem', 'payment', 'checkout']) {
      expect(routes).not.toContain(word);
    }
  });

  it('never lets a balance go negative', async () => {
    const { app, cid, loadLines } = setup(et(2026, 11, 21, 12));
    await loadLines();
    const a = await signUp(app, 'dave', cid);
    await watchAd(app, a, 'points', cid);
    const ad = (await watchAd(app, a, 'pick')).sessionId!;
    const r = await pick(app, a, { competitionId: cid, eventId: 'g1', market: 'moneyline', selection: 'home', points: 20, adSessionId: ad });
    expect(r.statusCode).toBe(402);
    // The ad wasn't used up, so a smaller pick still works with it.
    expect((await pick(app, a, { competitionId: cid, eventId: 'g1', market: 'moneyline', selection: 'home', points: 10, adSessionId: ad })).statusCode).toBe(200);
  });
});

describe('AdMob server-side verification', () => {
  it('accepts a correctly signed callback and rejects a tampered one', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const message = 'ad_network=5450213213286189855&ad_unit=1234&custom_data=session-1&reward_amount=10&reward_item=points&timestamp=1700000000000&transaction_id=abc&user_id=u1';
    const signer = createSign('sha256');
    signer.update(message);
    const sig = signer.sign(privateKey).toString('base64url');
    const keys = [{ keyId: 42, pem }];
    const good = verifyAdmobSsv(`${message}&signature=${sig}&key_id=42`, keys);
    expect(good?.get('custom_data')).toBe('session-1');
    expect(verifyAdmobSsv(`${message.replace('abc', 'abd')}&signature=${sig}&key_id=42`, keys)).toBeNull();
    expect(verifyAdmobSsv(`${message}&signature=${sig}&key_id=7`, keys)).toBeNull();
  });
});
