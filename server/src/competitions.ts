// Contests the admin creates from the admin page: daily, weekly or monthly,
// each with a fixed prize, an entry cap and start/end times.
//
// Everything happens inside a contest. Each player who joins starts that
// contest at 0 points, with its own 5 refills a day, its own picks and its own
// balance; nothing carries between contests. A player can join as many
// contests as they like. Standings rank entrants by their points in the
// contest: balance plus points still in play on ungraded picks.
//
// Rules that keep this a free contest:
//  - nobody pays to enter, and points can't be bought;
//  - a contest must be created before it starts, and its prize, cap and times
//    can't change once it has started;
//  - prizes are fixed text the admin writes; nothing links them to ad revenue.

import { randomUUID } from 'node:crypto';
import type { Config } from './config.ts';
import { openClaim } from './claims.ts';
import { tx, type DB } from './db.ts';
import { DAY, zonedParts, zonedToEpoch } from './time.ts';

export const KINDS = ['daily', 'weekly', 'monthly'] as const;
export type Kind = (typeof KINDS)[number];
export const PRIZE_TYPES = ['gift_card', 'physical'] as const;
export type PrizeType = (typeof PRIZE_TYPES)[number];

export interface Competition {
  id: string;
  name: string;
  kind: Kind;
  prize: string;
  prize_details: string;
  prize_value: number;
  prize_type: PrizeType;
  sport: string | null;
  max_entries: number;
  starts_at: number;
  ends_at: number;
  created_at: number;
  winner_user_id: string | null;
  finalized_at: number | null;
}

export interface CompetitionInput {
  name: string;
  kind: Kind;
  prize: string;
  prizeDetails: string;
  /** Retail value in dollars (0 if unknown). US prizes of $600+ ask the winner for a tax id. */
  prizeValue?: number;
  /** Gift card (default) or a physical prize. */
  prizeType?: PrizeType;
  /** Odds API sport key for a single-sport contest; empty or missing means any sport. */
  sport?: string | null;
  maxEntries: number;
  startsAt: number;
  endsAt: number;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

function validate(input: CompetitionInput, now: number): string | null {
  if (!input.name.trim()) return 'Give the contest a name.';
  if (!input.prize.trim()) return 'Enter the prize.';
  if (!Number.isInteger(input.maxEntries) || input.maxEntries < 1) return 'Max entries must be at least 1.';
  if (input.prizeValue !== undefined && !(Number.isInteger(input.prizeValue) && input.prizeValue >= 0)) return 'Prize value must be whole dollars.';
  if (!(input.endsAt > input.startsAt)) return 'The end must be after the start.';
  if (input.startsAt <= now) return 'Contests must be created before they start, so the prize is announced in advance.';
  return null;
}

export function getCompetition(db: DB, id: string): Competition | null {
  return (db.prepare('SELECT * FROM competitions WHERE id = ?').get(id) as Competition | undefined) ?? null;
}

export function createCompetition(db: DB, input: CompetitionInput, now: number): Result<Competition> {
  const err = validate(input, now);
  if (err) return { ok: false, error: err };
  const id = randomUUID();
  db.prepare(
    `INSERT INTO competitions (id, name, kind, prize, prize_details, prize_value, prize_type, sport, max_entries, starts_at, ends_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.name.trim(),
    input.kind,
    input.prize.trim(),
    input.prizeDetails.trim(),
    input.prizeValue ?? 0,
    input.prizeType ?? 'gift_card',
    input.sport || null,
    input.maxEntries,
    input.startsAt,
    input.endsAt,
    now,
  );
  return { ok: true, value: getCompetition(db, id)! };
}

/** Edit a contest. Only allowed before it starts. */
export function updateCompetition(db: DB, id: string, input: CompetitionInput, now: number): Result<Competition> {
  const c = getCompetition(db, id);
  if (!c) return { ok: false, error: 'Contest not found.' };
  if (now >= c.starts_at) return { ok: false, error: "This contest has started, so it can't be changed." };
  const err = validate(input, now);
  if (err) return { ok: false, error: err };
  const entries = entryCount(db, id);
  if (input.maxEntries < entries) return { ok: false, error: `${entries} players have already joined; max entries can't be lower than that.` };
  db.prepare(
    'UPDATE competitions SET name = ?, kind = ?, prize = ?, prize_details = ?, prize_value = ?, prize_type = ?, sport = ?, max_entries = ?, starts_at = ?, ends_at = ? WHERE id = ?',
  ).run(
    input.name.trim(),
    input.kind,
    input.prize.trim(),
    input.prizeDetails.trim(),
    input.prizeValue ?? 0,
    input.prizeType ?? 'gift_card',
    input.sport || null,
    input.maxEntries,
    input.startsAt,
    input.endsAt,
    id,
  );
  return { ok: true, value: getCompetition(db, id)! };
}

/** Delete a contest. Only allowed before it starts. */
export function deleteCompetition(db: DB, id: string, now: number): Result<null> {
  const c = getCompetition(db, id);
  if (!c) return { ok: false, error: 'Contest not found.' };
  if (now >= c.starts_at) return { ok: false, error: "This contest has started, so it can't be deleted." };
  tx(db, () => {
    db.prepare('DELETE FROM competition_entries WHERE competition_id = ?').run(id);
    db.prepare('DELETE FROM competitions WHERE id = ?').run(id);
  });
  return { ok: true, value: null };
}

export function entryCount(db: DB, id: string): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM competition_entries WHERE competition_id = ?').get(id) as { n: number }).n;
}

export type JoinResult = { ok: true } | { ok: false; error: 'not_found' | 'ended' | 'full' | 'already_joined' };

/** Join a contest. Free; allowed until it ends, while there's room. */
export function joinCompetition(db: DB, id: string, userId: string, now: number): JoinResult {
  return tx(db, (): JoinResult => {
    const c = getCompetition(db, id);
    if (!c) return { ok: false, error: 'not_found' };
    if (now >= c.ends_at) return { ok: false, error: 'ended' };
    if (db.prepare('SELECT 1 FROM competition_entries WHERE competition_id = ? AND user_id = ?').get(id, userId)) {
      return { ok: false, error: 'already_joined' };
    }
    if (entryCount(db, id) >= c.max_entries) return { ok: false, error: 'full' };
    db.prepare('INSERT INTO competition_entries (competition_id, user_id, joined_at) VALUES (?, ?, ?)').run(id, userId, now);
    return { ok: true };
  });
}

export interface ContestStanding {
  /** Players still tied after every tiebreaker share a rank. */
  rank: number;
  userId: string;
  displayName: string;
  /** Balance plus points on picks still in play. */
  score: number;
  refills: number;
  wins: number;
  losses: number;
  /** Wins / (wins + losses); forfeits count as losses, pushes and refunds are left out. */
  winPct: number;
}

/**
 * Entrants ranked by points in this contest (balance plus points in play).
 * Ties are broken by, in order: fewest refills used, highest win %, most
 * winning picks. Players still tied share the rank (and, at the top, the prize).
 */
export function contestStandings(db: DB, c: Competition, limit = 500): ContestStanding[] {
  const rows = db
    .prepare(
      `SELECT e.user_id AS userId, u.display_name AS displayName,
              e.balance + COALESCE((SELECT SUM(p.stake) FROM picks p
                                    WHERE p.competition_id = e.competition_id AND p.user_id = e.user_id AND p.status = 'pending'), 0) AS score,
              (SELECT COUNT(*) FROM ad_sessions a
               WHERE a.competition_id = e.competition_id AND a.user_id = e.user_id AND a.purpose = 'points' AND a.rewarded_at IS NOT NULL) AS refills,
              (SELECT COUNT(*) FROM picks p WHERE p.competition_id = e.competition_id AND p.user_id = e.user_id AND p.status = 'won') AS wins,
              (SELECT COUNT(*) FROM picks p WHERE p.competition_id = e.competition_id AND p.user_id = e.user_id AND p.status = 'lost') AS losses
       FROM competition_entries e
       JOIN users u ON u.id = e.user_id
       WHERE e.competition_id = ?`,
    )
    .all(c.id) as { userId: string; displayName: string; score: number; refills: number; wins: number; losses: number }[];
  const list = rows.map((r) => ({ ...r, winPct: r.wins + r.losses > 0 ? r.wins / (r.wins + r.losses) : 0 }));
  const cmp = (a: (typeof list)[number], b: (typeof list)[number]) =>
    b.score - a.score || a.refills - b.refills || b.winPct - a.winPct || b.wins - a.wins;
  list.sort((a, b) => cmp(a, b) || a.displayName.localeCompare(b.displayName));
  const out: ContestStanding[] = [];
  list.forEach((r, i) => {
    const rank = i > 0 && cmp(list[i - 1]!, r) === 0 ? out[i - 1]!.rank : i + 1;
    out.push({ rank, ...r });
  });
  return out.slice(0, limit);
}

/** Everyone ranked first: usually one player, more only if every tiebreaker is equal. */
export function contestWinners(db: DB, c: Competition): ContestStanding[] {
  return contestStandings(db, c).filter((s) => s.rank === 1 && s.score > 0);
}

export type Status = 'upcoming' | 'live' | 'ended';
export const statusOf = (c: Competition, now: number): Status => (now < c.starts_at ? 'upcoming' : now < c.ends_at ? 'live' : 'ended');

/** Record the winner once the contest is over and its picks are graded. */
export function finalizeCompetition(db: DB, id: string, now: number): Result<Competition> {
  const c = getCompetition(db, id);
  if (!c) return { ok: false, error: 'Contest not found.' };
  if (c.finalized_at) return { ok: true, value: c };
  if (now < c.ends_at) return { ok: false, error: "This contest hasn't ended yet." };
  const pending = db.prepare("SELECT COUNT(*) AS n FROM picks WHERE competition_id = ? AND status = 'pending'").get(id) as { n: number };
  if (pending.n > 0) return { ok: false, error: `${pending.n} picks in this contest are still waiting to be graded. Try again later.` };
  const winners = contestWinners(db, c);
  tx(db, () => {
    db.prepare('UPDATE competitions SET winner_user_id = ?, finalized_at = ? WHERE id = ?').run(winners[0]?.userId ?? null, now, id);
    // Each winner (all of them, if still tied after every tiebreaker) gets the
    // full prize and a claim to fill in from the app.
    for (const w of winners) openClaim(db, id, w.userId, now);
  });
  return { ok: true, value: getCompetition(db, id)! };
}

const fmtDay = (ms: number, tz: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' }).format(ms);

/** Same wall-clock time, `days` later in the app's time zone (handles daylight saving). */
function addDays(ms: number, days: number, tz: string): number {
  const p = zonedParts(ms, tz);
  return zonedToEpoch(p.year, p.month, p.day + days, p.hour, tz) + p.minute * 60_000;
}

export const KIND_LABEL: Record<Kind, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };

/** Suggested contests for the admin page's buttons. */
export function presets(cfg: Config, now: number) {
  const tz = cfg.timeZone;
  const p = zonedParts(now, tz);
  const tomorrow = zonedToEpoch(p.year, p.month, p.day + 1, 0, tz);
  const daysToMonday = ((8 - p.weekday) % 7) || 7;
  const nextMonday = zonedToEpoch(p.year, p.month, p.day + daysToMonday, 0, tz);
  const one = (kind: Kind, start: number, lengthDays: number) => ({
    kind,
    lengthDays,
    startsAt: start,
    endsAt: addDays(start, lengthDays, tz),
    name: `${KIND_LABEL[kind]}: ${fmtDay(start, tz)}`,
  });
  return {
    daily: one('daily', tomorrow, 1),
    weekly: one('weekly', tomorrow, 7),
    monthly: one('monthly', nextMonday, 30),
  };
}

export interface BulkInput {
  kind: Kind;
  /** Optional; each contest is named "<name or kind>: <start day>". */
  name: string;
  prize: string;
  prizeDetails: string;
  prizeValue?: number;
  prizeType?: PrizeType;
  sport?: string | null;
  maxEntries: number;
  firstStart: number;
  lengthDays: number;
  /** Days between one contest's start and the next (1 = every day, 7 = every week). */
  everyDays: number;
  count: number;
}

/** Create a run of contests, e.g. a 7-day contest starting every day, or a 30-day one every Monday. */
export function bulkCreate(db: DB, cfg: Config, input: BulkInput, now: number): Result<Competition[]> {
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > 60) return { ok: false, error: 'Create between 1 and 60 at a time.' };
  if (!(input.lengthDays > 0 && input.lengthDays <= 92)) return { ok: false, error: 'Length must be 1 to 92 days.' };
  if (!Number.isInteger(input.everyDays) || input.everyDays < 1) return { ok: false, error: 'Repeat every 1 or more days.' };
  const tz = cfg.timeZone;
  const inputs: CompetitionInput[] = [];
  for (let i = 0; i < input.count; i++) {
    const startsAt = addDays(input.firstStart, i * input.everyDays, tz);
    const endsAt = Number.isInteger(input.lengthDays) ? addDays(startsAt, input.lengthDays, tz) : startsAt + input.lengthDays * DAY;
    inputs.push({
      name: `${input.name.trim() || KIND_LABEL[input.kind]}: ${fmtDay(startsAt, tz)}`,
      kind: input.kind,
      prize: input.prize,
      prizeDetails: input.prizeDetails,
      prizeValue: input.prizeValue,
      prizeType: input.prizeType,
      sport: input.sport,
      maxEntries: input.maxEntries,
      startsAt,
      endsAt,
    });
  }
  for (const i of inputs) {
    const err = validate(i, now);
    if (err) return { ok: false, error: `${i.name}: ${err}` };
  }
  const made = tx(db, () => inputs.map((i) => createCompetition(db, i, now)));
  return { ok: true, value: made.map((r) => (r as { ok: true; value: Competition }).value) };
}

// ---- Browsing contests (the app's Contests screen) -------------------------

export const SORTS = ['soonest', 'popular', 'ending'] as const;

export interface ContestFilter {
  /** open = live or upcoming (the default); mine = ones the player joined that haven't ended. */
  status?: 'open' | 'live' | 'upcoming' | 'mine';
  sport?: string;
  /** Contests open to every sport match any sport filter too. */
  prizeType?: PrizeType;
  /** Entry cap (max players) range, inclusive. */
  sizeMin?: number;
  sizeMax?: number;
  /** Length in whole days, inclusive. No lengthMax means no upper limit. */
  lengthMin?: number;
  lengthMax?: number;
  /** Start time window (epoch ms). */
  startFrom?: number;
  startTo?: number;
  sort?: (typeof SORTS)[number];
  limit?: number;
  offset?: number;
}

/**
 * One page of contests matching the filter, filtered and sorted in SQL so it
 * stays fast with many contests. Returns one extra row to know if there's more.
 */
export function browseContests(db: DB, f: ContestFilter, now: number, userId: string | null): { rows: Competition[]; more: boolean } {
  const where: string[] = [];
  const args: (string | number | null)[] = [];
  const status = f.status ?? 'open';
  if (status === 'live') {
    where.push('c.starts_at <= ? AND c.ends_at > ?');
    args.push(now, now);
  } else if (status === 'upcoming') {
    where.push('c.starts_at > ?');
    args.push(now);
  } else {
    where.push('c.ends_at > ?');
    args.push(now);
  }
  if (status === 'mine') {
    where.push('EXISTS (SELECT 1 FROM competition_entries me WHERE me.competition_id = c.id AND me.user_id = ?)');
    args.push(userId ?? '');
  }
  if (f.sport === 'any') {
    // Only contests open to every sport.
    where.push('c.sport IS NULL');
  } else if (f.sport) {
    // That sport's own contests plus the ones open to every sport.
    where.push('(c.sport = ? OR c.sport IS NULL)');
    args.push(f.sport);
  }
  if (f.prizeType) {
    where.push('c.prize_type = ?');
    args.push(f.prizeType);
  }
  if (f.sizeMin !== undefined) {
    where.push('c.max_entries >= ?');
    args.push(f.sizeMin);
  }
  if (f.sizeMax !== undefined) {
    where.push('c.max_entries <= ?');
    args.push(f.sizeMax);
  }
  // Half a day of slack either side, so a 7-day contest across a DST change still counts as 7 days.
  if (f.lengthMin !== undefined) {
    where.push('(c.ends_at - c.starts_at) >= ?');
    args.push(Math.round((f.lengthMin - 0.5) * DAY));
  }
  if (f.lengthMax !== undefined) {
    where.push('(c.ends_at - c.starts_at) <= ?');
    args.push(Math.round((f.lengthMax + 0.5) * DAY));
  }
  if (f.startFrom !== undefined) {
    where.push('c.starts_at >= ?');
    args.push(f.startFrom);
  }
  if (f.startTo !== undefined) {
    where.push('c.starts_at < ?');
    args.push(f.startTo);
  }
  const entries = '(SELECT COUNT(*) FROM competition_entries e WHERE e.competition_id = c.id)';
  const order = {
    // Live ones first, then by start time.
    soonest: `(c.starts_at > ${Number(now)}), c.starts_at, c.ends_at, c.name`,
    popular: `${entries} DESC, c.starts_at`,
    ending: 'c.ends_at, c.starts_at',
  }[f.sort ?? 'soonest'];
  const limit = Math.min(Math.max(f.limit ?? 30, 1), 100);
  const offset = Math.max(f.offset ?? 0, 0);
  const rows = db
    .prepare(`SELECT c.* FROM competitions c WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...args, limit + 1, offset) as unknown as Competition[];
  return { rows: rows.slice(0, limit), more: rows.length > limit };
}
