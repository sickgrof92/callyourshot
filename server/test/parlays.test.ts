import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { createCompetition } from '../src/competitions.ts';
import { gradeEvent, parlayPayout, voidStalePicks } from '../src/grading.ts';
import { applyScores, ingestOdds } from '../src/lines.ts';
import { combinations, combinedPrice } from '../src/parlays.ts';
import { et, FakeOddsApi, signUpPlayer, testConfig, testDb, type FakeGame } from './helpers.ts';

const auth = (t: string) => ({ authorization: `Bearer ${t}` });
const SPORT = 'basketball_nba';

async function setup() {
  const db = testDb();
  const cfg = testConfig();
  let clock = et(2026, 11, 21, 12);
  const app = buildApp({ db, cfg, clock: () => clock });
  const games: FakeGame[] = [
    { id: 'g1', sport: SPORT, start: et(2026, 11, 21, 19), home: 'Knicks', away: 'Celtics' },
    { id: 'g2', sport: SPORT, start: et(2026, 11, 21, 19), home: 'Nets', away: 'Bulls' },
    { id: 'g3', sport: SPORT, start: et(2026, 11, 21, 20), home: 'Heat', away: 'Magic' },
    { id: 'g4', sport: SPORT, start: et(2026, 11, 21, 20), home: 'Suns', away: 'Kings' },
  ];
  const api = new FakeOddsApi(games, () => clock);
  ingestOdds(db, (await api.getOdds(SPORT)).data, cfg.preferredBooks, clock);
  const r = createCompetition(
    db,
    { name: 'Weekly', kind: 'weekly', prize: 'p', prizeDetails: '', maxEntries: 100, startsAt: et(2026, 11, 21, 5), endsAt: et(2026, 11, 28, 5) },
    et(2026, 11, 20, 0),
  );
  if (!r.ok) throw new Error(r.error);
  const cid = r.value.id;

  async function player(name: string, balance: number) {
    const token = await signUpPlayer(app, name);
    await app.inject({ method: 'POST', url: `/competitions/${cid}/join`, headers: auth(token) });
    const uid = (await app.inject({ method: 'GET', url: '/me', headers: auth(token) })).json().id as string;
    db.prepare('UPDATE competition_entries SET balance = ? WHERE competition_id = ? AND user_id = ?').run(balance, cid, uid);
    return { token, uid };
  }
  async function ad(token: string) {
    const s = (await app.inject({ method: 'POST', url: '/ads/sessions', headers: auth(token), payload: { purpose: 'pick' } })).json().sessionId as string;
    await app.inject({ method: 'POST', url: `/ads/sessions/${s}/stub-complete`, headers: auth(token) });
    return s;
  }
  const balance = (uid: string) => (db.prepare('SELECT balance FROM competition_entries WHERE competition_id = ? AND user_id = ?').get(cid, uid) as { balance: number }).balance;
  const score = (id: string, home: number, away: number, at = et(2026, 11, 22, 1)) => {
    const g = games.find((x) => x.id === id)!;
    applyScores(db, [{ id, sport_key: SPORT, commence_time: '', home_team: g.home, away_team: g.away, completed: true, scores: [{ name: g.home, score: String(home) }, { name: g.away, score: String(away) }] }], at);
    return gradeEvent(db, id, at);
  };
  const parlay = (token: string, payload: object) => app.inject({ method: 'POST', url: '/parlays', headers: auth(token), payload: { competitionId: cid, ...payload } });
  return { db, cfg, app, cid, player, ad, balance, score, parlay, setClock: (t: number) => (clock = t) };
}

// Knicks -150, Celtics +130 on the winner; totals 44.5 at -110.
const LEGS = [
  { eventId: 'g1', market: 'moneyline', selection: 'home' }, // -150
  { eventId: 'g2', market: 'moneyline', selection: 'away' }, // +130
  { eventId: 'g3', market: 'total', selection: 'over' }, // -110
];

describe('parlays', () => {
  it('pays the product of every game when all of them win', async () => {
    const s = await setup();
    const p = await s.player('parley', 50);
    const res = await s.parlay(p.token, { legs: LEGS, points: 10, adSessionId: await s.ad(p.token) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ totalPoints: 10, balance: 40 });
    expect(s.balance(p.uid)).toBe(40);

    expect(s.score('g1', 110, 100)).toBe(0); // nothing settles until every game is in
    expect(s.score('g2', 90, 100)).toBe(0);
    expect(s.score('g3', 30, 20)).toBe(1);
    const expected = parlayPayout(10, [-150, 130, -110]);
    expect(expected).toBe(73); // 10 × 1.667 × 2.3 × 1.909
    expect(s.balance(p.uid)).toBe(40 + expected);

    const mine = (await s.app.inject({ method: 'GET', url: `/picks?competitionId=${s.cid}`, headers: auth(p.token) })).json().picks;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ market: 'parlay', selection: 'parlay', status: 'won', payout: 73 });
    expect(mine[0].legs.map((l: { status: string }) => l.status)).toEqual(['won', 'won', 'won']);
  });

  it('loses as soon as one game loses, and drops a pushed game', async () => {
    const s = await setup();
    const a = await s.player('loser', 20);
    const b = await s.player('pusher', 20);
    await s.parlay(a.token, { legs: LEGS, points: 10, adSessionId: await s.ad(a.token) });
    await s.parlay(b.token, { legs: LEGS.slice(0, 2), points: 10, adSessionId: await s.ad(b.token) });
    // g1 ends in a tie on the winner line: a push. g2: Celtics lose.
    expect(s.score('g1', 100, 100)).toBe(0);
    expect(s.score('g2', 110, 100)).toBe(2); // both parlays are decided by g2's loss
    expect(s.balance(a.uid)).toBe(10);
    expect(s.balance(b.uid)).toBe(10);
  });

  it('pays on the games left when one is pushed, and refunds when all are', async () => {
    const s = await setup();
    const a = await s.player('pushone', 10);
    await s.parlay(a.token, { legs: LEGS.slice(0, 2), points: 10, adSessionId: await s.ad(a.token) });
    s.score('g1', 100, 100); // push
    s.score('g2', 90, 100); // Celtics win at +130
    expect(s.balance(a.uid)).toBe(23); // paid as a single at +130

    const b = await s.player('pushall', 10);
    s.setClock(et(2026, 11, 21, 12));
    await s.parlay(b.token, { legs: [LEGS[2], { eventId: 'g4', market: 'total', selection: 'under' }], points: 10, adSessionId: await s.ad(b.token) });
    // Neither game ever gets a result: refunded after 3 days.
    expect(voidStalePicks(s.db, et(2026, 11, 25, 12))).toBe(1);
    expect(s.balance(b.uid)).toBe(10);
  });

  it('builds a round robin of every combination, charging for each parlay', async () => {
    const s = await setup();
    const p = await s.player('robin', 30);
    const res = await s.parlay(p.token, { legs: LEGS, sizes: [2], points: 10, adSessionId: await s.ad(p.token) });
    expect(res.json()).toMatchObject({ totalPoints: 30, balance: 0 });
    expect(res.json().pickIds).toHaveLength(3);
    // g1 and g2 win, g3 loses: only the g1+g2 parlay pays.
    s.score('g1', 110, 100);
    s.score('g2', 90, 100);
    s.score('g3', 20, 20);
    expect(s.balance(p.uid)).toBe(parlayPayout(10, [-150, 130]));
    const mine = (await s.app.inject({ method: 'GET', url: '/picks', headers: auth(p.token) })).json().picks;
    expect(new Set(mine.map((x: { group_id: string }) => x.group_id)).size).toBe(1);
    expect(mine.map((x: { status: string }) => x.status).sort()).toEqual(['lost', 'lost', 'won']);
  });

  it('refuses bad parlays and needs an ad', async () => {
    const s = await setup();
    const p = await s.player('picky', 25);
    expect((await s.parlay(p.token, { legs: LEGS, points: 10 })).json().error).toBe('pick_ad_required');
    const ad = await s.ad(p.token);
    expect((await s.parlay(p.token, { legs: LEGS.slice(0, 1), points: 10, adSessionId: ad })).json().error).toBe('bad_legs');
    expect((await s.parlay(p.token, { legs: [LEGS[0], { eventId: 'g1', market: 'total', selection: 'over' }], points: 10, adSessionId: ad })).json().error).toBe('same_game');
    expect((await s.parlay(p.token, { legs: LEGS, sizes: [3], points: 10, adSessionId: ad })).json().error).toBe('bad_sizes');
    expect((await s.parlay(p.token, { legs: LEGS, sizes: [2], points: 10, adSessionId: ad })).json().error).toBe('not_enough_points');
    const moved = await s.parlay(p.token, { legs: [{ ...LEGS[0], expectedPrice: -120 }, LEGS[1]], points: 10, adSessionId: ad });
    expect(moved.json()).toMatchObject({ error: 'line_moved', eventId: 'g1', line: { price: -150 } });
    // The ad wasn't used up by the refusals.
    expect((await s.parlay(p.token, { legs: LEGS, points: 25, adSessionId: ad })).statusCode).toBe(200);
    s.setClock(et(2026, 11, 21, 19, 30));
    expect((await s.parlay(p.token, { legs: LEGS, points: 1, adSessionId: await s.ad(p.token) })).json().error).toBe('locked');
  });

  it('can be forfeited once its first game starts', async () => {
    const s = await setup();
    const p = await s.player('quitter', 10);
    const id = (await s.parlay(p.token, { legs: LEGS, points: 10, adSessionId: await s.ad(p.token) })).json().pickIds[0];
    const forfeitAd = async () => {
      const sid = (await s.app.inject({ method: 'POST', url: '/ads/sessions', headers: auth(p.token), payload: { purpose: 'forfeit' } })).json().sessionId;
      await s.app.inject({ method: 'POST', url: `/ads/sessions/${sid}/stub-complete`, headers: auth(p.token) });
      return sid;
    };
    const forfeit = async () => s.app.inject({ method: 'POST', url: `/picks/${id}/forfeit`, headers: auth(p.token), payload: { adSessionId: await forfeitAd() } });
    expect((await forfeit()).json().error).toBe('not_started');
    s.setClock(et(2026, 11, 21, 19, 5));
    expect((await forfeit()).statusCode).toBe(200);
    // Changing a parlay isn't supported.
    expect((await s.app.inject({ method: 'POST', url: `/picks/${id}/change`, headers: auth(p.token), payload: { market: 'moneyline', selection: 'home', points: 5 } })).statusCode).toBe(404);
  });

  it('can be changed, round robins included, until its first game starts', async () => {
    const s = await setup();
    const p = await s.player('changer', 40);
    const change = async (groupId: string, payload: object) =>
      s.app.inject({ method: 'POST', url: `/parlays/${groupId}/change`, headers: auth(p.token), payload: { competitionId: s.cid, ...payload } });
    const made = (await s.parlay(p.token, { legs: LEGS, sizes: [2], points: 10, adSessionId: await s.ad(p.token) })).json();
    expect(s.balance(p.uid)).toBe(10);
    // The 30 points come back, so a 40-point parlay fits.
    expect((await change(made.groupId, { legs: LEGS, points: 40 })).json().error).toBe('pick_ad_required');
    const res = await change(made.groupId, { legs: [LEGS[0], { eventId: 'g4', market: 'total', selection: 'under' }], points: 40, adSessionId: await s.ad(p.token) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ groupId: made.groupId, totalPoints: 40, balance: 0 });
    const mine = (await s.app.inject({ method: 'GET', url: '/picks', headers: auth(p.token) })).json().picks;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ selection: 'parlay', points: 40 });
    expect(mine[0].legs.map((l: { event_id: string }) => l.event_id).sort()).toEqual(['g1', 'g4']);
    expect((await change(made.groupId, { legs: LEGS, points: 41, adSessionId: await s.ad(p.token) })).json().error).toBe('not_enough_points');
    // Once its first game starts, it's locked.
    s.setClock(et(2026, 11, 21, 19, 1));
    expect((await change(made.groupId, { legs: [LEGS[2], { eventId: 'g4', market: 'total', selection: 'over' }], points: 10, adSessionId: await s.ad(p.token) })).json().error).toBe('locked');
    expect(s.balance(p.uid)).toBe(0);
  });

  it('has the helpers it needs', () => {
    expect(combinations([1, 2, 3, 4], 2)).toHaveLength(6);
    expect(combinations([1, 2, 3, 4], 3)).toEqual([[1, 2, 3], [1, 2, 4], [1, 3, 4], [2, 3, 4]]);
    expect(combinedPrice([-110, -110])).toBe(264);
  });
});
