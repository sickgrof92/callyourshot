import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type DB = DatabaseSync;

// Ledger kinds are an allow-list enforced by the database. There is deliberately
// no kind for buying, transferring or cashing out points: those features must not exist.
export const LEDGER_KINDS = ['ad_reward', 'pick_stake', 'pick_won', 'pick_push', 'pick_lost', 'pick_void'] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL UNIQUE COLLATE NOCASE,
  token_hash    TEXT NOT NULL UNIQUE,
  balance       INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  created_at    INTEGER NOT NULL
);

-- Every change to a balance is a ledger row. amount is the effect on the
-- spendable balance; score_delta is the effect on the leaderboard.
CREATE TABLE IF NOT EXISTS ledger (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      TEXT NOT NULL REFERENCES users(id),
  kind         TEXT NOT NULL CHECK (kind IN (${LEDGER_KINDS.map((k) => `'${k}'`).join(',')})),
  amount       INTEGER NOT NULL,
  score_delta  INTEGER NOT NULL,
  ref          TEXT,
  created_at   INTEGER NOT NULL,
  -- When the score counts for leaderboards. Ad rewards count when earned; pick
  -- results count at the game's start time, so a late game graded after
  -- midnight still belongs to the week it was played in.
  score_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ledger_score_at ON ledger(score_at);
CREATE INDEX IF NOT EXISTS ledger_user ON ledger(user_id, score_at);

CREATE TABLE IF NOT EXISTS events (
  id             TEXT PRIMARY KEY,
  sport          TEXT NOT NULL,
  home_team      TEXT NOT NULL,
  away_team      TEXT NOT NULL,
  commence_time  INTEGER NOT NULL,
  completed      INTEGER NOT NULL DEFAULT 0,
  home_score     INTEGER,
  away_score     INTEGER,
  lines_updated_at INTEGER,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS events_sport_time ON events(sport, commence_time);

CREATE TABLE IF NOT EXISTS lines (
  event_id   TEXT NOT NULL REFERENCES events(id),
  market     TEXT NOT NULL CHECK (market IN ('moneyline','spread','total')),
  selection  TEXT NOT NULL CHECK (selection IN ('home','away','over','under')),
  point      REAL,
  price      INTEGER NOT NULL,
  book       TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (event_id, market, selection)
);

CREATE TABLE IF NOT EXISTS picks (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  event_id    TEXT NOT NULL REFERENCES events(id),
  market      TEXT NOT NULL,
  selection   TEXT NOT NULL,
  point       REAL,
  price       INTEGER NOT NULL,
  stake       INTEGER NOT NULL CHECK (stake > 0),
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','won','lost','push','void')),
  payout      INTEGER,
  created_at  INTEGER NOT NULL,
  settled_at  INTEGER,
  forfeited_at INTEGER,
  UNIQUE (user_id, event_id, market)
);
CREATE INDEX IF NOT EXISTS picks_pending ON picks(status, event_id);

CREATE TABLE IF NOT EXISTS ad_sessions (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id),
  purpose        TEXT NOT NULL DEFAULT 'points' CHECK (purpose IN ('points','pick','forfeit')),
  created_at     INTEGER NOT NULL,
  rewarded_at    INTEGER,
  transaction_id TEXT UNIQUE,
  used_at        INTEGER,
  used_for       TEXT
);
CREATE INDEX IF NOT EXISTS ad_sessions_user ON ad_sessions(user_id, rewarded_at);

-- One row per Odds API request, with the usage headers it returned.
CREATE TABLE IF NOT EXISTS api_calls (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         INTEGER NOT NULL,
  endpoint   TEXT NOT NULL,
  sport      TEXT,
  cost       INTEGER NOT NULL,
  remaining  INTEGER,
  used       INTEGER,
  ok         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS api_calls_at ON api_calls(at);

CREATE TABLE IF NOT EXISTS sport_state (
  sport              TEXT PRIMARY KEY,
  last_odds_at       INTEGER,
  last_scores_at     INTEGER,
  last_events_at     INTEGER
);

CREATE TABLE IF NOT EXISTS budget_days (
  day_key     TEXT PRIMARY KEY,
  allowance   INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);

-- Prizes are fixed and announced before their period starts. Nothing here
-- references ad revenue, and there is no way to edit a prize once its period begins.
CREATE TABLE IF NOT EXISTS prizes (
  id            TEXT PRIMARY KEY,
  period_key    TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL,
  announced_at  INTEGER NOT NULL,
  winner_user_id TEXT REFERENCES users(id),
  finalized_at  INTEGER
);
`;

export function openDb(path: string): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  db.exec(SCHEMA);
  return db;
}

/** Bring databases created by older versions up to the current schema. */
function migrate(db: DB): void {
  const cols = db.prepare("SELECT name FROM pragma_table_info('ad_sessions')").all() as { name: string }[];
  if (cols.length === 0) return; // fresh database
  const has = (c: string) => cols.some((x) => x.name === c);
  if (!has('purpose')) {
    db.exec("ALTER TABLE ad_sessions ADD COLUMN purpose TEXT NOT NULL DEFAULT 'points' CHECK (purpose IN ('points','pick','forfeit'))");
  }
  if (!has('used_at')) db.exec('ALTER TABLE ad_sessions ADD COLUMN used_at INTEGER');
  if (!has('used_for')) db.exec('ALTER TABLE ad_sessions ADD COLUMN used_for TEXT');
  const pickCols = db.prepare("SELECT name FROM pragma_table_info('picks')").all() as { name: string }[];
  if (pickCols.length && !pickCols.some((x) => x.name === 'forfeited_at')) db.exec('ALTER TABLE picks ADD COLUMN forfeited_at INTEGER');
}

/** Run fn inside a write transaction. */
export function tx<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
