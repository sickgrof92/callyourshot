import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AD_PURPOSES, adEligibility, createAdSession, fetchAdmobKeys, grantAdReward, verifyAdmobSsv } from './ads.ts';
import { getBudgetStatus } from './budget.ts';
import { AD_REWARD_POINTS, SPORT_LABELS, type Config } from './config.ts';
import type { DB } from './db.ts';
import { announcePrize, currentPeriods, finalizePrize, prizeFor, standings, userScore } from './leaderboard.ts';
import type { LineRow } from './lines.ts';
import { forfeitPick, listPicks, placePick } from './picks.ts';
import { payoutMultiplier } from './points.ts';
import { HOUR, DAY, periodWindow } from './time.ts';

export interface AppDeps {
  db: DB;
  cfg: Config;
  clock?: () => number;
  logger?: boolean;
  fetchImpl?: typeof fetch;
}

interface User {
  id: string;
  display_name: string;
  balance: number;
}

const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

const displayName = z
  .string()
  .trim()
  .min(3)
  .max(20)
  .regex(/^[A-Za-z0-9_.]+$/, 'Letters, numbers, dots and underscores only');

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function buildApp({ db, cfg, clock = Date.now, logger = false, fetchImpl }: AppDeps): FastifyInstance {
  const app = Fastify({ logger });

  function bearer(req: FastifyRequest): string | null {
    const h = req.headers.authorization;
    return h?.startsWith('Bearer ') ? h.slice(7) : null;
  }

  function requireUser(req: FastifyRequest): User {
    const token = bearer(req);
    const user = token
      ? (db.prepare('SELECT id, display_name, balance FROM users WHERE token_hash = ?').get(hashToken(token)) as User | undefined)
      : undefined;
    if (!user) throw Object.assign(new Error('Sign in first'), { statusCode: 401 });
    return user;
  }

  function requireAdmin(req: FastifyRequest): void {
    const token = bearer(req);
    if (!cfg.adminToken || !token || !safeEqual(token, cfg.adminToken)) {
      throw Object.assign(new Error('Admin only'), { statusCode: 403 });
    }
  }

  app.setErrorHandler((err: { statusCode?: number; message: string } & Error, _req, reply) => {
    if (err instanceof z.ZodError) return reply.code(400).send({ error: 'bad_request', details: err.issues });
    const code = err.statusCode ?? 500;
    if (code >= 500) app.log.error(err);
    return reply.code(code).send({ error: code >= 500 ? 'server_error' : err.message });
  });

  app.get('/health', async () => ({ ok: true }));

  // ---- Accounts -------------------------------------------------------------

  app.post('/auth/guest', async (req, reply) => {
    const body = z.object({ displayName }).parse(req.body);
    const token = randomBytes(32).toString('base64url');
    const id = randomUUID();
    try {
      db.prepare('INSERT INTO users (id, display_name, token_hash, created_at) VALUES (?, ?, ?, ?)').run(
        id,
        body.displayName,
        hashToken(token),
        clock(),
      );
    } catch {
      return reply.code(409).send({ error: 'That name is taken' });
    }
    return { token, user: { id, displayName: body.displayName, balance: 0 } };
  });

  app.get('/me', async (req) => {
    const u = requireUser(req);
    const now = clock();
    const { weekly, monthly } = currentPeriods(now, cfg.timeZone);
    const e = adEligibility(db, cfg, u.id, now);
    return {
      id: u.id,
      displayName: u.display_name,
      balance: u.balance,
      minPickPoints: cfg.minPickPoints,
      canEarnPoints: e.canEarnPoints,
      picksInPlay: e.pendingPicks,
      pointsAdsToday: e.pointsAdsToday,
      pointsAdsPerDay: e.pointsAdsPerDay,
      adRewardPoints: AD_REWARD_POINTS,
      weeklyScore: userScore(db, weekly, u.id),
      monthlyScore: userScore(db, monthly, u.id),
    };
  });

  app.patch('/me', async (req, reply) => {
    const u = requireUser(req);
    const body = z.object({ displayName }).parse(req.body);
    try {
      db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(body.displayName, u.id);
    } catch {
      return reply.code(409).send({ error: 'That name is taken' });
    }
    return { ok: true };
  });

  // ---- Games and lines (served from cache; clients never call the Odds API) --

  app.get('/sports', async () => cfg.sports.map((key) => ({ key, label: SPORT_LABELS[key] ?? key })));

  app.get('/lines', async (req) => {
    const q = z.object({ sport: z.string() }).parse(req.query);
    const now = clock();
    const events = db
      .prepare(
        `SELECT id, sport, home_team, away_team, commence_time, lines_updated_at FROM events
         WHERE sport = ? AND completed = 0 AND commence_time >= ? AND commence_time < ?
         ORDER BY commence_time, id`,
      )
      .all(q.sport, now - 4 * HOUR, now + 8 * DAY) as {
      id: string;
      sport: string;
      home_team: string;
      away_team: string;
      commence_time: number;
      lines_updated_at: number | null;
    }[];
    const linesStmt = db.prepare('SELECT * FROM lines WHERE event_id = ?');
    return {
      sport: q.sport,
      events: events.map((e) => {
        const lines: Record<string, Record<string, { point: number | null; price: number; payout: number }>> = {};
        for (const l of linesStmt.all(e.id) as unknown as LineRow[]) {
          (lines[l.market] ??= {})[l.selection] = {
            point: l.point,
            price: l.price,
            payout: Math.round(payoutMultiplier(l.price) * 100) / 100,
          };
        }
        return {
          id: e.id,
          sport: e.sport,
          homeTeam: e.home_team,
          awayTeam: e.away_team,
          startsAt: new Date(e.commence_time).toISOString(),
          locked: now >= e.commence_time,
          linesUpdatedAt: e.lines_updated_at ? new Date(e.lines_updated_at).toISOString() : null,
          lines,
        };
      }),
    };
  });

  // ---- Picks ----------------------------------------------------------------

  app.post('/picks', async (req, reply) => {
    const u = requireUser(req);
    const body = z
      .object({
        eventId: z.string(),
        market: z.enum(['moneyline', 'spread', 'total']),
        selection: z.enum(['home', 'away', 'over', 'under']),
        points: z.number().int(),
        expectedPoint: z.number().nullable().optional(),
        expectedPrice: z.number().int().optional(),
        adSessionId: z.string().optional(),
      })
      .parse(req.body);
    const res = placePick(db, cfg, u.id, body, clock());
    if (res.ok) return { pickId: res.pickId, balance: res.balance };
    const status = { not_found: 404, locked: 409, no_line: 404, already_picked: 409, not_enough_points: 402, bad_amount: 400, line_moved: 409, pick_ad_required: 403 }[res.error];
    return reply.code(status).send(res);
  });

  // Give up a pending pick as a loss (needs a completed forfeit ad). Nothing is refunded.
  app.post('/picks/:id/forfeit', async (req, reply) => {
    const u = requireUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { adSessionId } = z.object({ adSessionId: z.string().optional() }).parse(req.body ?? {});
    const res = forfeitPick(db, u.id, id, adSessionId, clock());
    if (res.ok) return { balance: res.balance };
    return reply.code({ not_found: 404, not_started: 409, not_pending: 409, forfeit_ad_required: 403 }[res.error]).send(res);
  });

  app.get('/picks', async (req) => {
    const u = requireUser(req);
    return { picks: listPicks(db, u.id) };
  });

  // ---- Rewarded ads ---------------------------------------------------------

  app.post('/ads/sessions', async (req, reply) => {
    const u = requireUser(req);
    const { purpose } = z.object({ purpose: z.enum(AD_PURPOSES) }).parse(req.body ?? {});
    const res = createAdSession(db, cfg, u.id, purpose, clock());
    if (!res.ok) return reply.code(409).send({ error: res.reason });
    return {
      sessionId: res.sessionId,
      purpose,
      rewardPoints: purpose === 'pick' ? 0 : AD_REWARD_POINTS,
      provider: cfg.adProvider,
    };
  });

  app.get('/ads/sessions/:id', async (req) => {
    const u = requireUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const s = db.prepare('SELECT rewarded_at FROM ad_sessions WHERE id = ? AND user_id = ?').get(id, u.id) as
      | { rewarded_at: number | null }
      | undefined;
    if (!s) throw Object.assign(new Error('Not found'), { statusCode: 404 });
    const balance = (db.prepare('SELECT balance FROM users WHERE id = ?').get(u.id) as { balance: number }).balance;
    return { rewarded: s.rewarded_at !== null, balance };
  });

  // Development only: lets the app complete a fake ad without an ad network.
  app.post('/ads/sessions/:id/stub-complete', async (req, reply) => {
    if (cfg.adProvider !== 'stub') return reply.code(404).send({ error: 'Not found' });
    const u = requireUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const owner = db.prepare('SELECT user_id FROM ad_sessions WHERE id = ?').get(id) as { user_id: string } | undefined;
    if (!owner || owner.user_id !== u.id) return reply.code(404).send({ error: 'Not found' });
    const res = grantAdReward(db, cfg, id, `stub:${id}`, clock());
    return res.ok ? { rewarded: true, balance: res.balance, purpose: res.purpose } : reply.code(409).send({ error: res.reason });
  });

  // AdMob server-side verification callback. Configure this URL in the AdMob console.
  app.get('/ads/admob/ssv', async (req, reply) => {
    if (cfg.adProvider !== 'admob') return reply.code(404).send({ error: 'Not found' });
    const raw = req.raw.url?.split('?')[1] ?? '';
    const params = verifyAdmobSsv(raw, await fetchAdmobKeys(fetchImpl));
    if (!params) return reply.code(400).send({ error: 'bad signature' });
    const sessionId = params.get('custom_data');
    const txId = params.get('transaction_id');
    if (!sessionId || !txId) return reply.code(400).send({ error: 'missing custom_data or transaction_id' });
    const res = grantAdReward(db, cfg, sessionId, `admob:${txId}`, clock());
    // Always 200 for a valid signature so AdMob does not retry a reward we chose not to grant.
    return { granted: res.ok, reason: res.ok ? undefined : res.reason };
  });

  // ---- Leaderboards and prizes ---------------------------------------------

  app.get('/leaderboard', async (req) => {
    const q = z.object({ period: z.enum(['weekly', 'monthly']).default('weekly') }).parse(req.query);
    const now = clock();
    const window = periodWindow(q.period, now, cfg.timeZone);
    const rows = standings(db, window, 100);
    let me: { score: number; rank: number | null } | null = null;
    const token = bearer(req);
    if (token) {
      const u = db.prepare('SELECT id FROM users WHERE token_hash = ?').get(hashToken(token)) as { id: string } | undefined;
      if (u) me = { score: userScore(db, window, u.id), rank: rows.find((r) => r.userId === u.id)?.rank ?? null };
    }
    const prize = prizeFor(db, window.key);
    return {
      period: { key: window.key, type: q.period, startsAt: new Date(window.start).toISOString(), endsAt: new Date(window.end).toISOString() },
      prize: prize && { title: prize.title, description: prize.description, announcedAt: new Date(prize.announced_at).toISOString() },
      standings: rows.map(({ rank, displayName, score }) => ({ rank, displayName, score })),
      me,
    };
  });

  app.get('/prizes', async () => {
    const now = clock();
    const rows = db
      .prepare('SELECT period_key, title, description, announced_at FROM prizes ORDER BY period_key')
      .all() as { period_key: string; title: string; description: string; announced_at: number }[];
    const { weekly, monthly } = currentPeriods(now, cfg.timeZone);
    const nextWeekly = periodWindow('weekly', weekly.end, cfg.timeZone);
    const nextMonthly = periodWindow('monthly', monthly.end, cfg.timeZone);
    const keys = new Set([weekly.key, monthly.key, nextWeekly.key, nextMonthly.key]);
    return { prizes: rows.filter((r) => keys.has(r.period_key)).map((r) => ({ periodKey: r.period_key, title: r.title, description: r.description })) };
  });

  // ---- Admin ----------------------------------------------------------------

  app.get('/admin/budget', async (req) => {
    requireAdmin(req);
    const now = clock();
    const recent = db.prepare('SELECT * FROM api_calls ORDER BY id DESC LIMIT 50').all();
    return { budget: getBudgetStatus(db, cfg, now), recentCalls: recent };
  });

  app.post('/admin/prizes', async (req, reply) => {
    requireAdmin(req);
    const body = z
      .object({ periodKey: z.string(), title: z.string().min(1).max(100), description: z.string().max(1000).default('') })
      .parse(req.body);
    const res = announcePrize(db, cfg.timeZone, body, clock());
    return res.ok ? res.prize : reply.code(400).send({ error: res.error });
  });

  app.post('/admin/prizes/:periodKey/finalize', async (req, reply) => {
    requireAdmin(req);
    const { periodKey } = z.object({ periodKey: z.string() }).parse(req.params);
    const res = finalizePrize(db, cfg.timeZone, periodKey, clock());
    if (!res.ok) return reply.code(400).send({ error: res.error });
    const winner = res.prize.winner_user_id
      ? db.prepare('SELECT id, display_name FROM users WHERE id = ?').get(res.prize.winner_user_id)
      : null;
    return { prize: res.prize, winner };
  });

  return app;
}
