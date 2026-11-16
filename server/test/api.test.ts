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

async function watchAds(app: ReturnType<typeof buildApp>, token: string, n: number) {
  for (let i = 0; i < n; i++) {
    const s = await app.inject({ method: 'POST', url: '/ads/sessions', headers: { authorization: `Bearer ${token}` } });
    const id = s.json().sessionId;
    const done = await app.inject({ method: 'POST', url: `/ads/sessions/${id}/stub-complete`, headers: { authorization: `Bearer ${token}` } });
    expect(done.statusCode).toBe(200);
  }
}

describe('end-to-end', () => {
  it('earn points from ads, make a pick, lock at start, grade, and rank', async () => {
    const t0 = et(2026, 11, 21, 12);
    const { app, db, loadLines, setClock } = setup(t0);
    await loadLines();
    const a = await signUp(app, 'alice');
    const b = await signUp(app, 'bob');
    await watchAds(app, a, 5); // 50 points
    await watchAds(app, b, 2); // 20 points

    const me = await app.inject({ method: 'GET', url: '/me', headers: { authorization: `Bearer ${a}` } });
    expect(me.json().balance).toBe(50);
    expect(me.json().adsWatchedToday).toBe(5);

    const lines = (await app.inject({ method: 'GET', url: '/lines?sport=basketball_nba' })).json();
    expect(lines.events[0].lines.spread.home).toEqual({ point: -3.5, price: -110, payout: 1.91 });
    expect(lines.events[0].locked).toBe(false);

    // line moved check
    const moved = await app.inject({
      method: 'POST', url: '/picks', headers: { authorization: `Bearer ${a}` },
      payload: { eventId: 'g1', market: 'spread', selection: 'home', points: 20, expectedPoint: -2.5, expectedPrice: -110 },
    });
    expect(moved.statusCode).toBe(409);
    expect(moved.json().error).toBe('line_moved');

    const ok = await app.inject({
      method: 'POST', url: '/picks', headers: { authorization: `Bearer ${a}` },
      payload: { eventId: 'g1', market: 'spread', selection: 'home', points: 40, expectedPoint: -3.5, expectedPrice: -110 },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().balance).toBe(10);

    const dup = await app.inject({
      method: 'POST', url: '/picks', headers: { authorization: `Bearer ${a}` },
      payload: { eventId: 'g1', market: 'spread', selection: 'away', points: 10 },
    });
    expect(dup.json().error).toBe('already_picked');

    const broke = await app.inject({
      method: 'POST', url: '/picks', headers: { authorization: `Bearer ${b}` },
      payload: { eventId: 'g1', market: 'moneyline', selection: 'away', points: 30 },
    });
    expect(broke.json().error).toBe('not_enough_points');

    // Locks exactly at the scheduled start, without any API call.
    setClock(et(2026, 11, 21, 19) - 1);
    const justBefore = await app.inject({
      method: 'POST', url: '/picks', headers: { authorization: `Bearer ${b}` },
      payload: { eventId: 'g1', market: 'total', selection: 'over', points: 20 },
    });
    expect(justBefore.statusCode).toBe(200);
    setClock(et(2026, 11, 21, 19));
    const atStart = await app.inject({
      method: 'POST', url: '/picks', headers: { authorization: `Bearer ${b}` },
      payload: { eventId: 'g1', market: 'moneyline', selection: 'home', points: 10 },
    });
    expect(atStart.json().error).toBe('locked');

    // Final: Knicks 110-100. Alice (home -3.5) wins, Bob (over 44.5) wins.
    const end = et(2026, 11, 21, 22);
    setClock(end);
    applyScores(db, [{ id: 'g1', sport_key: 'basketball_nba', commence_time: '', home_team: 'Knicks', away_team: 'Celtics', completed: true, scores: [{ name: 'Knicks', score: '110' }, { name: 'Celtics', score: '100' }] }], end);
    expect(gradeEvent(db, 'g1', end)).toBe(2);

    const meAfter = (await app.inject({ method: 'GET', url: '/me', headers: { authorization: `Bearer ${a}` } })).json();
    expect(meAfter.balance).toBe(10 + 76); // 40 at -110 pays 76
    expect(meAfter.weeklyScore).toBe(50 + 36);

    const lb = (await app.inject({ method: 'GET', url: '/leaderboard?period=weekly', headers: { authorization: `Bearer ${b}` } })).json();
    expect(lb.standings.map((s: { displayName: string }) => s.displayName)).toEqual(['alice', 'bob']);
    expect(lb.me).toEqual({ score: 20 + 18, rank: 2 });
  });

  it('caps rewarded ads per day', async () => {
    const { app } = setup(et(2026, 11, 21, 12), { adDailyCap: 3 });
    const a = await signUp(app, 'alice');
    await watchAds(app, a, 3);
    const s = await app.inject({ method: 'POST', url: '/ads/sessions', headers: { authorization: `Bearer ${a}` } });
    expect(s.statusCode).toBe(429);
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
    await watchAds(app, a, 1);
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
    await watchAds(app, a, 1);
    const r = await app.inject({ method: 'POST', url: '/picks', headers: { authorization: `Bearer ${a}` }, payload: { eventId: 'g1', market: 'moneyline', selection: 'home', points: 20 } });
    expect(r.statusCode).toBe(402);
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
