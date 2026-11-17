import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { createCompetition } from '../src/competitions.ts';
import { notifyTick, type PushMessage } from '../src/notify.ts';
import { et, signUpPlayer, testConfig, testDb } from './helpers.ts';

const auth = (t: string) => ({ authorization: `Bearer ${t}` });

describe('push notifications', () => {
  it('sends the 4 kinds once each, and only the kinds a player has switched on', async () => {
    const db = testDb();
    const app = buildApp({ db, cfg: testConfig() });
    const mk = (name: string, start: number) => {
      const r = createCompetition(db, { name, kind: 'weekly', prize: '$50', prizeDetails: '', maxEntries: 9, startsAt: start, endsAt: start + 7 * 86400_000 }, et(2026, 11, 1, 0));
      if (!r.ok) throw new Error(r.error);
      return r.value.id;
    };
    const a = await signUpPlayer(app, 'alice');
    const b = await signUpPlayer(app, 'bob');
    const c1 = mk('Weekly: Sat, Nov 21', et(2026, 11, 21, 0));
    await app.inject({ method: 'POST', url: `/competitions/${c1}/join`, headers: auth(a) });
    for (const [t, tok] of [[a, 'ExponentPushToken[aaa]'], [b, 'ExponentPushToken[bbb]']] as const) {
      expect((await app.inject({ method: 'POST', url: '/me/push-token', headers: auth(t), payload: { token: tok } })).json()).toMatchObject({
        pushEnabled: true,
        contestStart: true,
        gameStart: true,
        results: true,
        newContests: true,
      });
    }
    // Bob switches off new-contest alerts only; it saves immediately.
    expect((await app.inject({ method: 'PUT', url: '/me/notifications', headers: auth(b), payload: { newContests: false } })).json()).toMatchObject({
      newContests: false,
      results: true,
    });

    const sent: PushMessage[] = [];
    const send = async (m: PushMessage[]) => {
      sent.push(...m);
      return { invalidTokens: [] };
    };
    expect(await notifyTick(db, send, et(2026, 11, 21, 0, 2))).toBe(1);
    expect(sent[0]).toMatchObject({ to: 'ExponentPushToken[aaa]', categoryId: 'contestStart', title: 'Weekly: Sat, Nov 21 has started!' });
    // Not sent twice.
    expect(await notifyTick(db, send, et(2026, 11, 21, 0, 3))).toBe(0);

    // A new contest opens: Alice (not in it) hears; Bob turned that kind off.
    mk('Weekly: Sun, Nov 22', et(2026, 11, 22, 0));
    await notifyTick(db, send, et(2026, 11, 22, 0, 1));
    expect(sent.slice(1).map((m) => [m.to, m.categoryId, m.title])).toEqual([['ExponentPushToken[aaa]', 'newContests', 'New contest: Weekly: Sun, Nov 22']]);

    // Game starting and pick results.
    const aliceId = (await app.inject({ method: 'GET', url: '/me', headers: auth(a) })).json().id;
    db.prepare("INSERT INTO events (id, sport, home_team, away_team, commence_time, updated_at) VALUES ('g', 'nba', 'Knicks', 'Celtics', ?, 0)").run(et(2026, 11, 22, 19));
    db.prepare("INSERT INTO picks (id, user_id, competition_id, event_id, market, selection, point, price, stake, created_at) VALUES ('p1', ?, ?, 'g', 'spread', 'home', -3.5, -110, 10, 0)").run(aliceId, c1);
    sent.length = 0;
    await notifyTick(db, send, et(2026, 11, 22, 19, 1));
    expect(sent).toMatchObject([{ categoryId: 'gameStart', title: 'Celtics at Knicks is starting', body: 'You have 1 pick in play. Good luck!' }]);
    db.prepare("UPDATE picks SET status = 'won', payout = 19, settled_at = ? WHERE id = 'p1'").run(et(2026, 11, 22, 22));
    sent.length = 0;
    await notifyTick(db, send, et(2026, 11, 22, 22, 1));
    expect(sent).toMatchObject([{ categoryId: 'results', title: 'You won! Knicks -3.5', body: '+9 pts in Weekly: Sat, Nov 21.', data: { kind: 'results' } }]);

    // Turning off results stops them.
    await app.inject({ method: 'PUT', url: '/me/notifications', headers: auth(a), payload: { results: false } });
    db.prepare("INSERT INTO picks (id, user_id, competition_id, event_id, market, selection, point, price, stake, status, payout, settled_at, created_at) VALUES ('p2', ?, ?, 'g', 'total', 'over', 200, -110, 10, 'lost', 0, ?, 0)").run(aliceId, c1, et(2026, 11, 22, 22, 2));
    sent.length = 0;
    await notifyTick(db, send, et(2026, 11, 22, 22, 3));
    expect(sent).toEqual([]);
  });

  it('drops tokens Expo says are no longer registered', async () => {
    const db = testDb();
    const app = buildApp({ db, cfg: testConfig() });
    const a = await signUpPlayer(app, 'alice');
    await app.inject({ method: 'POST', url: '/me/push-token', headers: auth(a), payload: { token: 'ExponentPushToken[old]' } });
    createCompetition(db, { name: 'W', kind: 'weekly', prize: 'p', prizeDetails: '', maxEntries: 9, startsAt: et(2026, 11, 21, 0), endsAt: et(2026, 11, 28, 0) }, et(2026, 11, 1, 0));
    await notifyTick(db, async (m) => ({ invalidTokens: m.map((x) => x.to) }), et(2026, 11, 21, 0, 1));
    expect((await app.inject({ method: 'GET', url: '/me/notifications', headers: auth(a) })).json().pushEnabled).toBe(false);
    expect((await app.inject({ method: 'POST', url: '/me/push-token', headers: auth(a), payload: { token: 'not a token' } })).statusCode).toBe(400);
  });
});
