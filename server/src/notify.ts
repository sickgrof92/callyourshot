// Push notifications through Expo's push service. Four kinds, each on by
// default and switchable on its own in the app:
//   contestStart  a contest you joined is starting
//   gameStart     a game you picked is starting
//   results       your pick won, lost or pushed
//   newContests   a new contest you haven't joined has opened
// Every message carries its kind, so the app's "Turn these off" button on the
// notification switches off exactly that kind.

import type { DB } from './db.ts';
import { lineLabel } from './format.ts';
import { HOUR, MINUTE } from './time.ts';

export const NOTIFY_KINDS = ['contestStart', 'gameStart', 'results', 'newContests'] as const;
export type NotifyKind = (typeof NOTIFY_KINDS)[number];

export const PREF_COLUMN: Record<NotifyKind, string> = {
  contestStart: 'notify_contest_start',
  gameStart: 'notify_game_start',
  results: 'notify_results',
  newContests: 'notify_new_contests',
};

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, string>;
  /** Matches the category the app registers, which adds the "Turn these off" button. */
  categoryId: NotifyKind;
  channelId: 'default';
  sound: 'default';
}

export type PushSender = (messages: PushMessage[]) => Promise<{ invalidTokens: string[] }>;

/** Sends through https://exp.host. Tokens Expo reports as unregistered are returned so we stop using them. */
export function expoPushSender(fetchImpl: typeof fetch = fetch, accessToken?: string): PushSender {
  return async (messages) => {
    const invalidTokens: string[] = [];
    for (let i = 0; i < messages.length; i += 100) {
      const chunk = messages.slice(i, i + 100);
      const res = await fetchImpl('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) },
        body: JSON.stringify(chunk),
      });
      if (!res.ok) throw new Error(`Expo push ${res.status}`);
      const body = (await res.json()) as { data?: { status: string; details?: { error?: string } }[] };
      body.data?.forEach((t, j) => {
        if (t.status === 'error' && t.details?.error === 'DeviceNotRegistered') invalidTokens.push(chunk[j]!.to);
      });
    }
    return { invalidTokens };
  };
}

export function getPrefs(db: DB, userId: string): Record<NotifyKind, boolean> & { pushEnabled: boolean } {
  const r = db
    .prepare('SELECT push_token, notify_contest_start, notify_game_start, notify_results, notify_new_contests FROM users WHERE id = ?')
    .get(userId) as Record<string, number | string | null>;
  return {
    contestStart: !!r.notify_contest_start,
    gameStart: !!r.notify_game_start,
    results: !!r.notify_results,
    newContests: !!r.notify_new_contests,
    pushEnabled: !!r.push_token,
  };
}

export function setPrefs(db: DB, userId: string, prefs: Partial<Record<NotifyKind, boolean>>): void {
  for (const k of NOTIFY_KINDS) {
    if (prefs[k] !== undefined) db.prepare(`UPDATE users SET ${PREF_COLUMN[k]} = ? WHERE id = ?`).run(prefs[k] ? 1 : 0, userId);
  }
}

const WINDOW = 15 * MINUTE;

interface Draft {
  key: string;
  userId: string;
  token: string;
  kind: NotifyKind;
  title: string;
  body: string;
  data: Record<string, string>;
}

/** Work out and send whatever is due. Each notification is sent at most once. Returns how many were sent. */
export async function notifyTick(db: DB, send: PushSender, now: number): Promise<number> {
  const drafts: Draft[] = [];
  const on = (k: NotifyKind) => `u.push_token IS NOT NULL AND u.${PREF_COLUMN[k]} = 1`;

  // 1. Contests you joined that just started.
  const starting = db.prepare('SELECT id, name, prize FROM competitions WHERE starts_at > ? AND starts_at <= ?').all(now - WINDOW, now) as {
    id: string;
    name: string;
    prize: string;
  }[];
  for (const c of starting) {
    const rows = db
      .prepare(`SELECT u.id, u.push_token FROM competition_entries e JOIN users u ON u.id = e.user_id WHERE e.competition_id = ? AND ${on('contestStart')}`)
      .all(c.id) as { id: string; push_token: string }[];
    for (const u of rows) {
      drafts.push({
        key: `contestStart:${c.id}:${u.id}`,
        userId: u.id,
        token: u.push_token,
        kind: 'contestStart',
        title: `${c.name} has started!`,
        body: 'You start at 0. Watch a video for your first 10 points and make your picks.',
        data: { kind: 'contestStart', contestId: c.id },
      });
    }
  }

  // 2. New contests you haven't joined (one message even if several open at once).
  if (starting.length) {
    const users = db.prepare(`SELECT u.id, u.push_token FROM users u WHERE ${on('newContests')}`).all() as { id: string; push_token: string }[];
    const joined = db.prepare('SELECT 1 FROM competition_entries WHERE competition_id = ? AND user_id = ?');
    for (const u of users) {
      const fresh = starting.filter((c) => !joined.get(c.id, u.id));
      if (!fresh.length) continue;
      drafts.push({
        key: `newContests:${fresh.map((c) => c.id).join(',')}:${u.id}`,
        userId: u.id,
        token: u.push_token,
        kind: 'newContests',
        title: fresh.length === 1 ? `New contest: ${fresh[0]!.name}` : `${fresh.length} new contests are open`,
        body: fresh.length === 1 ? `Prize: ${fresh[0]!.prize}. Free to join.` : fresh.map((c) => `${c.name}: ${c.prize}`).join('\n'),
        data: { kind: 'newContests', contestId: fresh.length === 1 ? fresh[0]!.id : '' },
      });
    }
  }

  // 3. Games you picked that are starting.
  const games = db
    .prepare(
      `SELECT e.id, e.home_team, e.away_team, p.user_id, u.push_token, COUNT(*) AS n
       FROM events e JOIN picks p ON p.event_id = e.id JOIN users u ON u.id = p.user_id
       WHERE e.commence_time > ? AND e.commence_time <= ? AND p.status = 'pending' AND ${on('gameStart')}
       GROUP BY e.id, p.user_id`,
    )
    .all(now - WINDOW, now) as { id: string; home_team: string; away_team: string; user_id: string; push_token: string; n: number }[];
  for (const g of games) {
    drafts.push({
      key: `gameStart:${g.id}:${g.user_id}`,
      userId: g.user_id,
      token: g.push_token,
      kind: 'gameStart',
      title: `${g.away_team} at ${g.home_team} is starting`,
      body: `You have ${g.n} pick${g.n === 1 ? '' : 's'} in play. Good luck!`,
      data: { kind: 'gameStart', eventId: g.id },
    });
  }

  // 4. Picks that were just graded (forfeits are left out: the player chose that).
  const graded = db
    .prepare(
      `SELECT p.id, p.user_id, p.competition_id, p.market, p.selection, p.point, p.stake, p.payout, p.status, e.home_team, e.away_team, u.push_token, c.name AS contest
       FROM picks p JOIN events e ON e.id = p.event_id JOIN users u ON u.id = p.user_id JOIN competitions c ON c.id = p.competition_id
       WHERE p.settled_at > ? AND p.settled_at <= ? AND p.status IN ('won', 'lost', 'push') AND p.forfeited_at IS NULL AND ${on('results')}`,
    )
    .all(now - 2 * HOUR, now) as {
    id: string;
    user_id: string;
    competition_id: string;
    market: string;
    selection: string;
    point: number | null;
    stake: number;
    payout: number;
    status: 'won' | 'lost' | 'push';
    home_team: string;
    away_team: string;
    push_token: string;
    contest: string;
  }[];
  for (const p of graded) {
    const label = lineLabel(p.market, p.selection, p.point, p.home_team, p.away_team);
    drafts.push({
      key: `results:${p.id}`,
      userId: p.user_id,
      token: p.push_token,
      kind: 'results',
      title: p.status === 'won' ? `You won! ${label}` : p.status === 'lost' ? `Pick lost: ${label}` : `Push: ${label}`,
      body:
        p.status === 'won'
          ? `+${p.payout - p.stake} pts in ${p.contest}.`
          : p.status === 'lost'
            ? `${p.stake} pts gone in ${p.contest}. On to the next one.`
            : `Your ${p.stake} pts are back in ${p.contest}.`,
      data: { kind: 'results', contestId: p.competition_id, pickId: p.id },
    });
  }

  const sent = db.prepare('INSERT INTO notifications_sent (key, sent_at) VALUES (?, ?) ON CONFLICT DO NOTHING');
  const todo = drafts.filter((d) => sent.run(d.key, now).changes === 1);
  if (!todo.length) return 0;
  const { invalidTokens } = await send(
    todo.map((d) => ({ to: d.token, title: d.title, body: d.body, data: d.data, categoryId: d.kind, channelId: 'default', sound: 'default' })),
  );
  for (const t of invalidTokens) db.prepare('UPDATE users SET push_token = NULL WHERE push_token = ?').run(t);
  return todo.length;
}
