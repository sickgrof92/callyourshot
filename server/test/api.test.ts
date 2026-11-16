import { generateKeyPairSync, createSign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyAdmobSsv } from '../src/ads.ts';
import { buildApp } from '../src/app.ts';
import { LEDGER_KINDS } from '../src/db.ts';
import { gradeEvent } from '../src/grading.ts';
import { applyScores, ingestOdds } from '../src/lines.ts';
import { et, FakeOddsApi, testConfig, testDb, type FakeGame } from './helpers.ts';

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
  return {
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

async function signUp(app: ReturnType<typeof buildApp>, name: string) {
  const res = await app.inject({ method: 'POST', url: '/auth/guest', payload: { displayName: name } });
  expect(res.statusCode).toBe(200);
  return res.json().token as string;
}

type App = ReturnType<typeof buildApp>;
const auth = (token: string) => ({ authorization: `Bearer ${token}` });

/** Start and complete (stub) an ad of the given purpose. Returns the HTTP results. */
async function watchAd(app: App, token: string, purpose: 'points' | 'pick' | 'forfeit') {
  const start = await app.inject({ method: 'POST', url: '/ads/sessions', headers: auth(token), payload: { purpose } });
  if (start.statusCode !== 200) return { start, sessionId: null as string | null };
  const sessionId = start.json().sessionId as string;
  const done = await app.inject({ method: 'POST', url: `/ads/sessions/${sessionId}/stub-complete`, headers: auth(token) });
  expect(done.statusCode).toBe(200);
  return { start, sessionId };
}

async function pick(app: App, token: string, payload: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: '/picks', headers: auth(token), payload });
}

describe('end-to-end', () => {
  it('points video to start, an ad before every pick, more points only when out, lock at start, grade, and rank', async () => {
    const t0 = et(2026, 11, 21, 12);
    const { app, db, loadLines, setClock } = setup(t0);
    await loadLines();
    const a = await signUp(app, 'alice');
    const b = await signUp(app, 'bob');

    // New players start at 0 and watch a video for their first 10 points.
    expect((await app.inject({ method: 'GET', url: '/me', headers: auth(a) })).json()).toMatchObject({ balance: 0, canEarnPoints: true, pointsAdsToday: 0, pointsAdsPerDay: 5 });
    await watchAd(app, a, 'points');
    // Can't watch for more points while you still have points.
    expect((await watchAd(app, a, 'points')).start.json().error).toBe('not_out_of_points');
    await watchAd(app, b, 'points');

    const me = (await app.inject({ method: 'GET', url: '/me', headers: auth(a) })).json();
    expect(me).toMatchObject({ balance: 10, canEarnPoints: false, pointsAdsToday: 1 });

    const lines = (await app.inject({ method: 'GET', url: '/lines?sport=basketball_nba' })).json();
    expect(lines.events[0].lines.spread.home).toEqual({ point: -3.5, price: -110, payout: 1.91 });

    // No ad, no pick.
    const noAd = await pick(app, a, { eventId: 'g1', market: 'spread', selection: 'home', points: 10 });
    expect(noAd.statusCode).toBe(403);
    expect(noAd.json().error).toBe('pick_ad_required');
    // Watching a pick ad gives no points.
    const ad1 = (await watchAd(app, a, 'pick')).sessionId!;
    expect((await app.inject({ method: 'GET', url: '/me', headers: auth(a) })).json().balance).toBe(10);

    // A moved line doesn't use up the ad.
    const moved = await pick(app, a, { eventId: 'g1', market: 'spread', selection: 'home', points: 10, expectedPoint: -2.5, expectedPrice: -110, adSessionId: ad1 });
    expect(moved.json().error).toBe('line_moved');
    const ok = await pick(app, a, { eventId: 'g1', market: 'spread', selection: 'home', points: 10, expectedPoint: -3.5, expectedPrice: -110, adSessionId: ad1 });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().balance).toBe(0);

    // One ad, one pick.
    const reuse = await pick(app, a, { eventId: 'g1', market: 'moneyline', selection: 'home', points: 10, adSessionId: ad1 });
    expect(reuse.json().error).toBe('pick_ad_required');
    // Someone else's ad doesn't work either.
    const bobsAd = (await watchAd(app, b, 'pick')).sessionId!;
    expect((await pick(app, a, { eventId: 'g1', market: 'moneyline', selection: 'home', points: 10, adSessionId: bobsAd })).json().error).toBe('pick_ad_required');

    // At 0 but with a pick still in play: no points video until it's graded (or forfeited).
    expect((await app.inject({ method: 'GET', url: '/me', headers: auth(a) })).json()).toMatchObject({ balance: 0, picksInPlay: 1, canEarnPoints: false });
    expect((await watchAd(app, a, 'points')).start.json().error).toBe('points_in_play');

    // Locks exactly at the scheduled start, without any API call.
    setClock(et(2026, 11, 21, 19) - 1);
    // Pick ads expire after 30 minutes, so Bob watches a fresh one.
    expect((await pick(app, b, { eventId: 'g1', market: 'total', selection: 'under', points: 10, adSessionId: bobsAd })).json().error).toBe('pick_ad_required');
    const bobsFreshAd = (await watchAd(app, b, 'pick')).sessionId!;
    const justBefore = await pick(app, b, { eventId: 'g1', market: 'total', selection: 'under', points: 10, adSessionId: bobsFreshAd });
    expect(justBefore.statusCode).toBe(200);
    setClock(et(2026, 11, 21, 19));
    const lateAd = (await watchAd(app, a, 'pick')).sessionId!;
    expect((await pick(app, a, { eventId: 'g1', market: 'moneyline', selection: 'home', points: 10, adSessionId: lateAd })).json().error).toBe('locked');

    // Final: Knicks 110-100. Alice (home -3.5) wins, Bob (under 44.5) loses.
    const end = et(2026, 11, 21, 22);
    setClock(end);
    applyScores(db, [{ id: 'g1', sport_key: 'basketball_nba', commence_time: '', home_team: 'Knicks', away_team: 'Celtics', completed: true, scores: [{ name: 'Knicks', score: '110' }, { name: 'Celtics', score: '100' }] }], end);
    expect(gradeEvent(db, 'g1', end)).toBe(2);

    const meAfter = (await app.inject({ method: 'GET', url: '/me', headers: auth(a) })).json();
    expect(meAfter.balance).toBe(19); // 10 at -110 pays 19
    expect(meAfter.weeklyScore).toBe(10 + 9); // points video + net win

    const lb = (await app.inject({ method: 'GET', url: '/leaderboard?period=weekly', headers: auth(b) })).json();
    expect(lb.standings.map((s: { displayName: string }) => s.displayName)).toEqual(['alice', 'bob']);
    expect(lb.me).toEqual({ score: 0, rank: 2 }); // 10 from the video, -10 on the pick
    // Bob is out with nothing in play, so he can watch for points again.
    expect((await app.inject({ method: 'GET', url: '/me', headers: auth(b) })).json().canEarnPoints).toBe(true);
  });

  it('forfeits a pick as a loss after an ad, only once the game has started, so the player can earn points again', async () => {
    const { app, db, loadLines, setClock } = setup(et(2026, 11, 21, 12));
    await loadLines();
    const e = await signUp(app, 'erin');
    await watchAd(app, e, 'points');
    const ad = (await watchAd(app, e, 'pick')).sessionId!;
    const placed = await pick(app, e, { eventId: 'g1', market: 'spread', selection: 'away', points: 10, adSessionId: ad });
    const pickId = placed.json().pickId as string;

    // Out of points but a pick is still in play: no points video yet.
    expect((await watchAd(app, e, 'points')).start.json().error).toBe('points_in_play');

    const forfeit = (body: Record<string, unknown>) =>
      app.inject({ method: 'POST', url: `/picks/${pickId}/forfeit`, headers: auth(e), payload: body });
    // Not before the game starts.
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
    const me = (await app.inject({ method: 'GET', url: '/me', headers: auth(e) })).json();
    expect(me).toMatchObject({ weeklyScore: 0, canEarnPoints: true, picksInPlay: 0 });

    // Grading later doesn't touch the forfeited pick.
    applyScores(db, [{ id: 'g1', sport_key: 'basketball_nba', commence_time: '', home_team: 'Knicks', away_team: 'Celtics', completed: true, scores: [{ name: 'Knicks', score: '90' }, { name: 'Celtics', score: '100' }] }], et(2026, 11, 21, 22));
    expect(gradeEvent(db, 'g1', et(2026, 11, 21, 22))).toBe(0);
    expect((await watchAd(app, e, 'points')).sessionId).not.toBeNull();
  });

  it('allows at most 5 points videos a day, counting the first, and only while out of points', async () => {
    const { app, db, setClock } = setup(et(2026, 11, 21, 12));
    const c = await signUp(app, 'carol');
    const spendAll = () => db.prepare("UPDATE users SET balance = 0 WHERE display_name = 'carol'").run();
    for (let i = 0; i < 5; i++) {
      spendAll();
      expect((await watchAd(app, c, 'points')).sessionId).not.toBeNull();
    }
    spendAll();
    expect((await watchAd(app, c, 'points')).start.json().error).toBe('daily_limit');
    // A new day (after 5 AM Eastern) resets the count.
    setClock(et(2026, 11, 22, 6));
    expect((await watchAd(app, c, 'points')).sessionId).not.toBeNull();
  });

  it('does not pay twice if two points videos were started at once', async () => {
    const { app } = setup(et(2026, 11, 21, 12));
    const d = await signUp(app, 'dana');
    const s1 = (await app.inject({ method: 'POST', url: '/ads/sessions', headers: auth(d), payload: { purpose: 'points' } })).json().sessionId;
    const s2 = (await app.inject({ method: 'POST', url: '/ads/sessions', headers: auth(d), payload: { purpose: 'points' } })).json().sessionId;
    expect((await app.inject({ method: 'POST', url: `/ads/sessions/${s1}/stub-complete`, headers: auth(d) })).statusCode).toBe(200);
    const second = await app.inject({ method: 'POST', url: `/ads/sessions/${s2}/stub-complete`, headers: auth(d) });
    expect(second.json().error).toBe('not_out_of_points');
    expect((await app.inject({ method: 'GET', url: '/me', headers: auth(d) })).json().balance).toBe(10);
  });

  it('only announces prizes before their period starts, and finalizes the winner after', async () => {
    const now = et(2026, 11, 18, 12); // Wednesday
    const { app, setClock } = setup(now);
    const admin = { authorization: 'Bearer admin-secret' };
    const late = await app.inject({ method: 'POST', url: '/admin/prizes', headers: admin, payload: { periodKey: 'weekly:2026-11-16', title: '$50 gift card' } });
    expect(late.statusCode).toBe(400);
    const ok = await app.inject({ method: 'POST', url: '/admin/prizes', headers: admin, payload: { periodKey: 'weekly:2026-11-23', title: '$50 gift card' } });
    expect(ok.statusCode).toBe(200);
    const noAuth = await app.inject({ method: 'POST', url: '/admin/prizes', payload: { periodKey: 'weekly:2026-11-30', title: 'x' } });
    expect(noAuth.statusCode).toBe(403);

    setClock(et(2026, 11, 24, 12));
    const a = await signUp(app, 'carol');
    await watchAd(app, a, 'points');
    const lb = (await app.inject({ method: 'GET', url: '/leaderboard?period=weekly' })).json();
    expect(lb.prize.title).toBe('$50 gift card');

    const early = await app.inject({ method: 'POST', url: '/admin/prizes/weekly:2026-11-23/finalize', headers: admin });
    expect(early.statusCode).toBe(400);
    setClock(et(2026, 12, 1, 1));
    const fin = await app.inject({ method: 'POST', url: '/admin/prizes/weekly:2026-11-23/finalize', headers: admin });
    expect(fin.statusCode).toBe(200);
    expect(fin.json().winner.display_name).toBe('carol');
  });
});

describe('no paid or transferable points', () => {
  it('has no ledger kind for buying, transferring or cashing out', () => {
    expect([...LEDGER_KINDS]).toEqual(['ad_reward', 'pick_stake', 'pick_won', 'pick_push', 'pick_lost', 'pick_void']);
    const db = testDb();
    db.prepare("INSERT INTO users (id, display_name, token_hash, created_at) VALUES ('u', 'u', 'h', 0)").run();
    expect(() =>
      db.prepare("INSERT INTO ledger (user_id, kind, amount, score_delta, created_at, score_at) VALUES ('u', 'purchase', 100, 100, 0, 0)").run(),
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
    const { app, loadLines } = setup(et(2026, 11, 21, 12));
    await loadLines();
    const a = await signUp(app, 'dave');
    await watchAd(app, a, 'points');
    const ad = (await watchAd(app, a, 'pick')).sessionId!;
    const r = await pick(app, a, { eventId: 'g1', market: 'moneyline', selection: 'home', points: 20, adSessionId: ad });
    expect(r.statusCode).toBe(402);
    // The ad wasn't used up, so a smaller pick still works with it.
    expect((await pick(app, a, { eventId: 'g1', market: 'moneyline', selection: 'home', points: 10, adSessionId: ad })).statusCode).toBe(200);
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
