import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AD_PURPOSES, adEligibility, createAdSession, fetchAdmobKeys, grantAdReward, verifyAdmobSsv } from './ads.ts';
import { emailKey, IdentityVerifier, normalizePhone, PROVIDERS } from './auth.ts';
import { CLAIM_STATUSES, claimInfo, getClaim, listClaims, setClaimStatus, submitClaim } from './claims.ts';
import { checkRegion, COUNTRIES } from './eligibility.ts';
import { getBudgetStatus } from './budget.ts';
import {
  contestStandings,
  createCompetition,
  deleteCompetition,
  entryCount,
  finalizeCompetition,
  getCompetition,
  joinCompetition,
  bulkCreate,
  KINDS,
  presets,
  statusOf,
  updateCompetition,
  type Competition,
} from './competitions.ts';
import { AD_REWARD_POINTS, SPORT_LABELS, type Config } from './config.ts';
import type { DB } from './db.ts';
import type { LineRow } from './lines.ts';
import { forfeitPick, listPicks, placePick } from './picks.ts';
import { playerStats } from './profiles.ts';
import { getPrefs, NOTIFY_KINDS, setPrefs } from './notify.ts';
import { entryBalance, payoutMultiplier } from './points.ts';
import { HOUR, DAY } from './time.ts';

export interface AppDeps {
  db: DB;
  cfg: Config;
  clock?: () => number;
  logger?: boolean;
  fetchImpl?: typeof fetch;
  verifier?: IdentityVerifier;
}

interface User {
  id: string;
  display_name: string;
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

export function buildApp({ db, cfg, clock = Date.now, logger = false, fetchImpl, verifier = new IdentityVerifier(cfg) }: AppDeps): FastifyInstance {
  const app = Fastify({ logger });

  function bearer(req: FastifyRequest): string | null {
    const h = req.headers.authorization;
    return h?.startsWith('Bearer ') ? h.slice(7) : null;
  }

  function requireUser(req: FastifyRequest): User {
    const token = bearer(req);
    const user = token
      ? (db.prepare('SELECT id, display_name FROM users WHERE token_hash = ?').get(hashToken(token)) as User | undefined)
      : undefined;
    if (!user) throw Object.assign(new Error('Sign in first'), { statusCode: 401 });
    return user;
  }

  // Slow down password guessing on the admin page: 10 wrong tries per IP per 15 minutes.
  const failures = new Map<string, { n: number; since: number }>();
  function requireAdmin(req: FastifyRequest): void {
    const now = Date.now();
    const f = failures.get(req.ip);
    if (f && now - f.since < 15 * 60_000 && f.n >= 10) {
      throw Object.assign(new Error('Too many wrong passwords. Try again in 15 minutes.'), { statusCode: 429 });
    }
    const token = bearer(req);
    if (!cfg.adminToken || !token || !safeEqual(token, cfg.adminToken)) {
      const cur = f && now - f.since < 15 * 60_000 ? f : { n: 0, since: now };
      failures.set(req.ip, { n: cur.n + 1, since: cur.since });
      throw Object.assign(new Error('Admin only'), { statusCode: 403 });
    }
    failures.delete(req.ip);
  }

  function optionalUserId(req: FastifyRequest): string | null {
    const token = bearer(req);
    if (!token) return null;
    const u = db.prepare('SELECT id FROM users WHERE token_hash = ?').get(hashToken(token)) as { id: string } | undefined;
    return u?.id ?? null;
  }

  function contestJson(c: Competition, now: number, userId: string | null) {
    const joined = userId
      ? !!db.prepare('SELECT 1 FROM competition_entries WHERE competition_id = ? AND user_id = ?').get(c.id, userId)
      : false;
    // The player's own state in this contest: points, refills and picks in play.
    const e = joined && userId ? adEligibility(db, cfg, userId, c.id, now) : null;
    const winnerRows = c.finalized_at
      ? (db.prepare('SELECT u.id, u.display_name FROM prize_claims pc JOIN users u ON u.id = pc.user_id WHERE pc.competition_id = ? ORDER BY u.display_name').all(c.id) as {
          id: string;
          display_name: string;
        }[])
      : [];
    const winner = winnerRows.length ? winnerRows.map((w) => w.display_name).join(' & ') : null;
    return {
      id: c.id,
      name: c.name,
      kind: c.kind,
      prize: c.prize,
      prizeDetails: c.prize_details,
      prizeValue: c.prize_value,
      maxEntries: c.max_entries,
      entries: entryCount(db, c.id),
      startsAt: new Date(c.starts_at).toISOString(),
      endsAt: new Date(c.ends_at).toISOString(),
      status: statusOf(c, now),
      joined,
      winner,
      claim: userId ? (getClaim(db, c.id, userId)?.status ?? null) : null,
      mine: e && {
        balance: e.balance,
        picksInPlay: e.pendingPicks,
        canEarnPoints: e.canEarnPoints,
        pointsAdsToday: e.pointsAdsToday,
        pointsAdsPerDay: e.pointsAdsPerDay,
      },
    };
  }

  app.setErrorHandler((err: { statusCode?: number; message: string } & Error, _req, reply) => {
    if (err instanceof z.ZodError) return reply.code(400).send({ error: 'bad_request', details: err.issues });
    const code = err.statusCode ?? 500;
    if (code >= 500) app.log.error(err);
    return reply.code(code).send({ error: code >= 500 ? 'server_error' : err.message });
  });

  app.get('/health', async () => ({ ok: true }));

  // ---- Sign-in ---------------------------------------------------------------

  app.get('/auth/config', async () => ({ mode: cfg.authMode, providers: PROVIDERS }));

  // Sign in with Apple or Google. A new player also sends a display name, email
  // and phone number; each email and phone number can be on only one account.
  const signInBody = z.object({
    provider: z.enum(PROVIDERS),
    idToken: z.string().min(1).max(8000),
    profile: z
      .object({
        displayName,
        email: z.string().max(254),
        phone: z.string().max(32),
        country: z.enum(COUNTRIES),
        region: z.string().length(2).toUpperCase(),
        /** The player ticked "I agree to the Official Rules and Privacy Policy" and confirmed their age. */
        acceptedTerms: z.literal(true),
      })
      .optional(),
  });

  app.post('/auth/signin', async (req, reply) => {
    const body = signInBody.parse(req.body);
    const now = clock();
    const who = await verifier.verify(body.provider, body.idToken, now);
    if (!who) return reply.code(401).send({ error: 'invalid_sign_in' });

    const token = randomBytes(32).toString('base64url');
    const existing = db.prepare('SELECT id, display_name FROM users WHERE auth_provider = ? AND auth_sub = ?').get(who.provider, who.sub) as
      | User
      | undefined;
    if (existing) {
      // Signing in again (e.g. on a new phone) moves the session to this device.
      db.prepare('UPDATE users SET token_hash = ? WHERE id = ?').run(hashToken(token), existing.id);
      return { token, user: { id: existing.id, displayName: existing.display_name } };
    }

    if (!body.profile) return { needsProfile: true, email: who.email };
    const p = body.profile;
    const ek = emailKey(p.email);
    if (!ek) return reply.code(400).send({ error: 'bad_email' });
    const phone = normalizePhone(p.phone);
    if (!phone) return reply.code(400).send({ error: 'bad_phone' });
    const where = checkRegion(p.country, p.region);
    if (!where.ok) return reply.code(where.error === 'region_not_eligible' ? 403 : 400).send({ error: where.error });
    if (db.prepare('SELECT 1 FROM users WHERE email_key = ?').get(ek)) return reply.code(409).send({ error: 'email_taken' });
    if (db.prepare('SELECT 1 FROM users WHERE phone = ?').get(phone)) return reply.code(409).send({ error: 'phone_taken' });
    if (db.prepare('SELECT 1 FROM users WHERE display_name = ?').get(p.displayName)) return reply.code(409).send({ error: 'name_taken' });

    const id = randomUUID();
    try {
      db.prepare(
        `INSERT INTO users (id, display_name, token_hash, created_at, auth_provider, auth_sub, email, email_key, phone, country, region,
                            terms_accepted_at, terms_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, p.displayName, hashToken(token), now, who.provider, who.sub, p.email.trim(), ek, phone, p.country, p.region, now, cfg.termsVersion);
    } catch {
      return reply.code(409).send({ error: 'taken' }); // lost a race with another sign-up
    }
    return { token, user: { id, displayName: p.displayName } };
  });

  app.get('/me', async (req) => {
    const u = requireUser(req);
    return {
      id: u.id,
      displayName: u.display_name,
      minPickPoints: cfg.minPickPoints,
      maxPickPoints: cfg.maxPickPoints,
      pointsAdsPerDay: cfg.pointsAdsPerDay,
      adRewardPoints: AD_REWARD_POINTS,
    };
  });

  // Notification switches: each kind on its own, saved the moment it's flipped.
  app.get('/me/notifications', async (req) => getPrefs(db, requireUser(req).id));

  app.put('/me/notifications', async (req) => {
    const u = requireUser(req);
    const body = z.object(Object.fromEntries(NOTIFY_KINDS.map((k) => [k, z.boolean().optional()]))).parse(req.body);
    setPrefs(db, u.id, body as Partial<Record<(typeof NOTIFY_KINDS)[number], boolean>>);
    return getPrefs(db, u.id);
  });

  app.post('/me/push-token', async (req) => {
    const u = requireUser(req);
    const { token } = z.object({ token: z.string().regex(/^Expo(nent)?PushToken\[[^\]]+\]$/).nullable() }).parse(req.body);
    // A device token belongs to whoever signed in on it last.
    if (token) db.prepare('UPDATE users SET push_token = NULL WHERE push_token = ? AND id != ?').run(token, u.id);
    db.prepare('UPDATE users SET push_token = ? WHERE id = ?').run(token, u.id);
    return getPrefs(db, u.id);
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
        competitionId: z.string(),
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
    const status = {
      not_found: 404,
      locked: 409,
      no_line: 404,
      already_picked: 409,
      not_enough_points: 402,
      bad_amount: 400,
      line_moved: 409,
      pick_ad_required: 403,
      not_joined: 403,
      contest_not_live: 409,
      after_contest_end: 409,
    }[res.error];
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
    const { competitionId } = z.object({ competitionId: z.string().optional() }).parse(req.query);
    return { picks: listPicks(db, u.id, competitionId ?? null) };
  });

  // ---- Rewarded ads ---------------------------------------------------------

  app.post('/ads/sessions', async (req, reply) => {
    const u = requireUser(req);
    const { purpose, competitionId } = z.object({ purpose: z.enum(AD_PURPOSES), competitionId: z.string().optional() }).parse(req.body ?? {});
    // A person can't watch more than a few dozen ads an hour; anything above that is a script.
    const recent = db.prepare('SELECT COUNT(*) AS n FROM ad_sessions WHERE user_id = ? AND created_at > ?').get(u.id, clock() - HOUR) as { n: number };
    if (recent.n >= 60) return reply.code(429).send({ error: 'too_many_ads' });
    const res = createAdSession(db, cfg, u.id, purpose, clock(), competitionId);
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
    const s = db.prepare('SELECT rewarded_at, competition_id FROM ad_sessions WHERE id = ? AND user_id = ?').get(id, u.id) as
      | { rewarded_at: number | null; competition_id: string | null }
      | undefined;
    if (!s) throw Object.assign(new Error('Not found'), { statusCode: 404 });
    const balance = s.competition_id ? entryBalance(db, s.competition_id, u.id) : 0;
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
    // Fraud checks on top of Google's signature: the view must be for the
    // player who started the session, on one of our ad units, and recent.
    const session = db.prepare('SELECT user_id FROM ad_sessions WHERE id = ?').get(sessionId) as { user_id: string } | undefined;
    const refuse = (reason: string) => {
      app.log.warn({ sessionId, reason }, 'refused AdMob reward');
      return { granted: false, reason };
    };
    if (!session) return refuse('unknown_session');
    if (params.get('user_id') !== session.user_id) return refuse('wrong_user');
    const unit = params.get('ad_unit') ?? '';
    if (cfg.admobAdUnits.length && !cfg.admobAdUnits.includes(unit)) return refuse('wrong_ad_unit');
    const ts = Number(params.get('timestamp'));
    if (!Number.isFinite(ts) || Math.abs(clock() - ts) > HOUR) return refuse('stale');
    const res = grantAdReward(db, cfg, sessionId, `admob:${txId}`, clock());
    // Always 200 for a valid signature so AdMob does not retry a reward we chose not to grant.
    return { granted: res.ok, reason: res.ok ? undefined : res.reason };
  });

  // ---- Contests (players) ---------------------------------------------------

  app.get('/competitions', async (req) => {
    const now = clock();
    const userId = optionalUserId(req);
    // Upcoming and live, plus anything that ended in the last 3 days.
    const rows = db
      .prepare('SELECT * FROM competitions WHERE ends_at > ? ORDER BY starts_at, ends_at, name')
      .all(now - 3 * DAY) as unknown as Competition[];
    return { competitions: rows.map((c) => contestJson(c, now, userId)) };
  });

  app.get('/competitions/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const c = getCompetition(db, id);
    if (!c) return reply.code(404).send({ error: 'not_found' });
    const now = clock();
    const userId = optionalUserId(req);
    const all = contestStandings(db, c);
    const mine = userId ? all.find((r) => r.userId === userId) : undefined;
    return {
      competition: contestJson(c, now, userId),
      standings: all.slice(0, 100).map(({ rank, displayName, score }) => ({ rank, displayName, score })),
      me: mine ? { rank: mine.rank, score: mine.score } : null,
    };
  });

  app.post('/competitions/:id/join', async (req, reply) => {
    const u = requireUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const res = joinCompetition(db, id, u.id, clock());
    if (res.ok) return { joined: true };
    return reply.code({ not_found: 404, ended: 409, full: 409, already_joined: 409 }[res.error]).send(res);
  });

  // ---- Public player profiles ---------------------------------------------

  app.get('/players/:name', async (req, reply) => {
    const { name } = z.object({ name: z.string().max(40) }).parse(req.params);
    return playerStats(db, name) ?? reply.code(404).send({ error: 'not_found' });
  });

  // ---- Prize claims (winners) ----------------------------------------------

  app.get('/competitions/:id/claim', async (req, reply) => {
    const u = requireUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const info = claimInfo(db, id, u.id);
    return info ?? reply.code(404).send({ error: 'not_winner' });
  });

  const claimBody = z.object({
    legalName: z.string().max(120),
    address: z.object({
      line1: z.string().max(200),
      line2: z.string().max(200).optional(),
      city: z.string().max(100),
      region: z.string().length(2).toUpperCase(),
      postalCode: z.string().max(12),
      country: z.enum(COUNTRIES),
    }),
    birthDate: z.string().max(10),
    taxId: z.string().max(20).optional(),
    skillAnswer: z.number().int().optional(),
  });

  app.post('/competitions/:id/claim', async (req, reply) => {
    const u = requireUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const res = submitClaim(db, cfg, id, u.id, claimBody.parse(req.body), clock());
    if (res.ok) return { status: res.status };
    const code = { not_winner: 404, already_submitted: 409, not_configured: 503, under_age: 403, region_not_eligible: 403, too_many_attempts: 403 } as Record<string, number>;
    return reply.code(code[res.error] ?? 400).send(res);
  });

  // ---- Legal pages ----------------------------------------------------------
  // The app links here. Replace the files in src/legal/ with the final text.

  for (const [route, file] of [['/privacy', 'privacy.html'], ['/rules', 'rules.html']] as const) {
    const html = readFileSync(new URL(`./legal/${file}`, import.meta.url), 'utf8');
    app.get(route, async (_req, reply) => reply.type('text/html; charset=utf-8').send(html));
  }

  // ---- Admin page -----------------------------------------------------------

  const adminHtml = readFileSync(new URL('./admin.html', import.meta.url), 'utf8');
  app.get('/admin', async (_req, reply) => reply.type('text/html; charset=utf-8').header('cache-control', 'no-store').send(adminHtml));

  const contestBody = z.object({
    name: z.string().max(80),
    kind: z.enum(KINDS),
    prize: z.string().max(120),
    prizeDetails: z.string().max(1000).default(''),
    prizeValue: z.number().int().min(0).default(0),
    maxEntries: z.number().int(),
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }),
  });
  const toInput = (b: z.infer<typeof contestBody>) => ({ ...b, startsAt: Date.parse(b.startsAt), endsAt: Date.parse(b.endsAt) });

  app.get('/admin/competitions', async (req) => {
    requireAdmin(req);
    const now = clock();
    const rows = db.prepare('SELECT * FROM competitions ORDER BY starts_at DESC LIMIT 200').all() as unknown as Competition[];
    const p = presets(cfg, now);
    return {
      now: new Date(now).toISOString(),
      timeZone: cfg.timeZone,
      presets: Object.fromEntries(
        Object.entries(p).map(([k, v]) => [
          k,
          { name: v.name, lengthDays: v.lengthDays, startsAt: new Date(v.startsAt).toISOString(), endsAt: new Date(v.endsAt).toISOString() },
        ]),
      ),
      competitions: rows.map((c) => contestJson(c, now, null)),
      budget: (({ remaining, allowanceToday, spentToday, mode }) => ({ remaining, allowanceToday, spentToday, mode }))(getBudgetStatus(db, cfg, now)),
    };
  });

  app.post('/admin/competitions', async (req, reply) => {
    requireAdmin(req);
    const res = createCompetition(db, toInput(contestBody.parse(req.body)), clock());
    return res.ok ? contestJson(res.value, clock(), null) : reply.code(400).send({ error: res.error });
  });

  // Create a run of contests at once, e.g. a 7-day contest starting every day for a week.
  app.post('/admin/competitions/bulk', async (req, reply) => {
    requireAdmin(req);
    const b = z
      .object({
        kind: z.enum(KINDS),
        name: z.string().max(60).default(''),
        prize: z.string().max(120),
        prizeDetails: z.string().max(1000).default(''),
        prizeValue: z.number().int().min(0).default(0),
        maxEntries: z.number().int(),
        firstStart: z.string().datetime({ offset: true }),
        lengthDays: z.number(),
        everyDays: z.number().int(),
        count: z.number().int(),
      })
      .parse(req.body);
    const res = bulkCreate(db, cfg, { ...b, firstStart: Date.parse(b.firstStart) }, clock());
    return res.ok ? { created: res.value.map((c) => contestJson(c, clock(), null)) } : reply.code(400).send({ error: res.error });
  });

  app.put('/admin/competitions/:id', async (req, reply) => {
    requireAdmin(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const res = updateCompetition(db, id, toInput(contestBody.parse(req.body)), clock());
    return res.ok ? contestJson(res.value, clock(), null) : reply.code(400).send({ error: res.error });
  });

  app.delete('/admin/competitions/:id', async (req, reply) => {
    requireAdmin(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const res = deleteCompetition(db, id, clock());
    return res.ok ? { deleted: true } : reply.code(400).send({ error: res.error });
  });

  app.post('/admin/competitions/:id/finalize', async (req, reply) => {
    requireAdmin(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const res = finalizeCompetition(db, id, clock());
    return res.ok ? contestJson(res.value, clock(), null) : reply.code(400).send({ error: res.error });
  });

  app.get('/admin/competitions/:id/standings', async (req, reply) => {
    requireAdmin(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const c = getCompetition(db, id);
    if (!c) return reply.code(404).send({ error: 'not_found' });
    // Full tiebreak detail for the admin page.
    return { standings: contestStandings(db, c, 50).map(({ userId: _u, ...r }) => r) };
  });

  // Winners' claim forms (decrypted for the admin only) and their status.
  app.get('/admin/claims', async (req) => {
    requireAdmin(req);
    return { claims: listClaims(db, cfg), claimsKeySet: !!cfg.claimsKey };
  });

  app.put('/admin/claims/:competitionId/:userId', async (req, reply) => {
    requireAdmin(req);
    const { competitionId, userId } = z.object({ competitionId: z.string(), userId: z.string() }).parse(req.params);
    const b = z.object({ status: z.enum(CLAIM_STATUSES), note: z.string().max(500).optional() }).parse(req.body);
    return setClaimStatus(db, competitionId, userId, b.status, b.note, clock()) ? { ok: true } : reply.code(404).send({ error: 'not_found' });
  });

  // ---- Admin ----------------------------------------------------------------

  app.get('/admin/budget', async (req) => {
    requireAdmin(req);
    const now = clock();
    const recent = db.prepare('SELECT * FROM api_calls ORDER BY id DESC LIMIT 50').all();
    return { budget: getBudgetStatus(db, cfg, now), recentCalls: recent };
  });

  return app;
}
