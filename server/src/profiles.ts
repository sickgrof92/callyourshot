// Public player profiles: career stats across every contest. Only the display
// name is public; email, phone and location never appear here.

import type { DB } from './db.ts';

export interface PlayerStats {
  displayName: string;
  joinedAt: string;
  wins: number;
  losses: number;
  /** Pushes. */
  ties: number;
  /** wins / (wins + losses); forfeits count as losses, ties are left out. Null before any result. */
  winPct: number | null;
  longestWinStreak: number;
  currentWinStreak: number;
  /** Points videos watched, across all contests. */
  reloads: number;
  contestsJoined: number;
  contestsWon: number;
}

export function playerStats(db: DB, displayName: string): PlayerStats | null {
  const u = db.prepare('SELECT id, display_name, created_at FROM users WHERE display_name = ?').get(displayName) as
    | { id: string; display_name: string; created_at: number }
    | undefined;
  if (!u) return null;
  const results = db
    .prepare(
      `SELECT p.status FROM picks p LEFT JOIN events e ON e.id = p.event_id
       WHERE p.user_id = ? AND p.status IN ('won', 'lost', 'push')
       ORDER BY COALESCE(e.commence_time, p.settled_at), p.settled_at, p.created_at`,
    )
    .all(u.id) as { status: 'won' | 'lost' | 'push' }[];
  let wins = 0;
  let losses = 0;
  let ties = 0;
  let run = 0;
  let best = 0;
  for (const r of results) {
    if (r.status === 'won') {
      wins++;
      run++;
      best = Math.max(best, run);
    } else if (r.status === 'lost') {
      losses++;
      run = 0;
    } else ties++; // a push neither extends nor breaks a streak
  }
  const n = (sql: string) => (db.prepare(sql).get(u.id) as { n: number }).n;
  return {
    displayName: u.display_name,
    joinedAt: new Date(u.created_at).toISOString(),
    wins,
    losses,
    ties,
    winPct: wins + losses > 0 ? wins / (wins + losses) : null,
    longestWinStreak: best,
    currentWinStreak: run,
    // Every points video is a reload, except the first one in a contest joined before
    // starting points were credited on joining (that video was the starting points).
    reloads: n(
      `SELECT COUNT(*) - COUNT(DISTINCT CASE WHEN NOT EXISTS (SELECT 1 FROM ledger l WHERE l.user_id = a.user_id AND l.competition_id = a.competition_id AND l.kind = 'join_bonus')
                                         THEN a.competition_id END) AS n
       FROM ad_sessions a WHERE a.user_id = ? AND a.purpose = 'points' AND a.rewarded_at IS NOT NULL`,
    ),
    contestsJoined: n('SELECT COUNT(*) AS n FROM competition_entries WHERE user_id = ?'),
    contestsWon: n('SELECT COUNT(*) AS n FROM prize_claims WHERE user_id = ?'),
  };
}
