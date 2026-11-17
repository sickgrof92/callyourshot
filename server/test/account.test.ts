import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { et, signUpPlayer, testConfig, testDb } from './helpers.ts';

const ADMIN = { authorization: 'Bearer admin-secret' };
const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const iso = (ms: number) => new Date(ms).toISOString();

function setup() {
  const db = testDb();
  const app = buildApp({ db, cfg: testConfig(), clock: () => et(2026, 11, 20, 12) });
  return { db, app };
}

describe('deleting an account', () => {
  it('needs the typed confirmation, then removes the player and frees their email and phone', async () => {
    const { db, app } = setup();
    const a = await signUpPlayer(app, 'alice');
    const id = (
      await app.inject({
        method: 'POST',
        url: '/admin/competitions',
        headers: ADMIN,
        payload: { name: 'W', kind: 'weekly', prize: '$50', maxEntries: 10, startsAt: iso(et(2026, 11, 21, 0)), endsAt: iso(et(2026, 11, 28, 0)) },
      })
    ).json().id;
    await app.inject({ method: 'POST', url: `/competitions/${id}/join`, headers: auth(a) });
    await app.inject({ method: 'POST', url: '/contact', headers: auth(a), payload: { topic: 'other', body: 'Please delete me' } });

    expect((await app.inject({ method: 'DELETE', url: '/me', headers: auth(a), payload: {} })).statusCode).toBe(400);
    const res = await app.inject({ method: 'DELETE', url: '/me', headers: auth(a), payload: { confirm: 'DELETE' } });
    expect(res.json()).toEqual({ deleted: true, kept: 'nothing' });

    expect((await app.inject({ method: 'GET', url: '/me', headers: auth(a) })).statusCode).toBe(401);
    expect(db.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM competition_entries').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM contact_messages').get()).toEqual({ n: 0 });
    expect((await app.inject({ method: 'GET', url: '/players/alice' })).statusCode).toBe(404);
    // The same email and phone can sign up again.
    await signUpPlayer(app, 'alice2');
  });

  it('keeps a paid prize record but clears everything personal', async () => {
    const { db, app } = setup();
    const a = await signUpPlayer(app, 'alice');
    const u = db.prepare("SELECT id FROM users WHERE display_name = 'alice'").get() as { id: string };
    db.prepare(`INSERT INTO competitions (id, name, kind, prize, max_entries, starts_at, ends_at, created_at, winner_user_id, finalized_at)
      VALUES ('c1', 'Old', 'weekly', '$50', 10, 1, 2, 0, ?, 3)`).run(u.id);
    db.prepare(`INSERT INTO prize_claims (competition_id, user_id, status, created_at, updated_at) VALUES ('c1', ?, 'paid', 0, 0)`).run(u.id);
    const res = await app.inject({ method: 'DELETE', url: '/me', headers: auth(a), payload: { confirm: 'DELETE' } });
    expect(res.json().kept).toBe('paid_prize_records');
    const row = db.prepare('SELECT display_name, email, phone, auth_sub, push_token FROM users WHERE id = ?').get(u.id) as Record<string, unknown>;
    expect(row).toMatchObject({ email: null, phone: null, auth_sub: null, push_token: null });
    expect(String(row.display_name)).toMatch(/^deleted_/);
    expect((await app.inject({ method: 'GET', url: '/me', headers: auth(a) })).statusCode).toBe(401);
  });
});
