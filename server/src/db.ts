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
  created_at    INTEGER NOT NULL,
  -- Sign-in (Apple or Google) and contact details given at sign-up.
  auth_provider TEXT,
  auth_sub      TEXT,
  email         TEXT,
  email_key     TEXT,
  phone         TEXT,
  -- Where they live (US state or Canadian province). Quebec is not eligible.
  country       TEXT,
  region        TEXT,
  -- When they agreed to the Official Rules and Privacy Policy, and which version.
  terms_accepted_at INTEGER,
  terms_version TEXT,
  -- Expo push token, and which of the 4 notification kinds they want (all on by default).
  push_token    TEXT,
  notify_contest_start INTEGER NOT NULL DEFAULT 1,
  notify_game_start    INTEGER NOT NULL DEFAULT 1,
  notify_results       INTEGER NOT NULL DEFAULT 1,
  notify_new_contests  INTEGER NOT NULL DEFAULT 1,
  -- Set once SMS verification is turned on and the player confirms a code.
  phone_verified_at INTEGER
);
-- One account per sign-in, per email and per phone number.
CREATE UNIQUE INDEX IF NOT EXISTS users_auth ON users(auth_provider, auth_sub);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users(email_key);
CREATE UNIQUE INDEX IF NOT EXISTS users_phone ON users(phone);

-- Every change to a contest balance is a ledger row. Points only exist
-- inside a contest: each entry starts at 0, and nothing moves between contests.
CREATE TABLE IF NOT EXISTS ledger (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        TEXT NOT NULL REFERENCES users(id),
  competition_id TEXT NOT NULL REFERENCES competitions(id),
  kind           TEXT NOT NULL CHECK (kind IN (${LEDGER_KINDS.map((k) => `'${k}'`).join(',')})),
  amount         INTEGER NOT NULL,
  ref            TEXT,
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ledger_entry ON ledger(competition_id, user_id);

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
  competition_id TEXT NOT NULL REFERENCES competitions(id),
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
  UNIQUE (competition_id, user_id, event_id, market)
);
CREATE INDEX IF NOT EXISTS picks_pending ON picks(status, event_id);
CREATE INDEX IF NOT EXISTS picks_entry ON picks(competition_id, user_id, status);

CREATE TABLE IF NOT EXISTS ad_sessions (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id),
  purpose        TEXT NOT NULL DEFAULT 'points' CHECK (purpose IN ('points','pick','forfeit')),
  -- Points videos refill one contest's balance.
  competition_id TEXT REFERENCES competitions(id),
  created_at     INTEGER NOT NULL,
  rewarded_at    INTEGER,
  transaction_id TEXT UNIQUE,
  used_at        INTEGER,
  used_for       TEXT
);
CREATE INDEX IF NOT EXISTS ad_sessions_user ON ad_sessions(user_id, competition_id, rewarded_at);

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

-- Contests the admin creates. Prize, cap and times are fixed once a contest starts.
CREATE TABLE IF NOT EXISTS competitions (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('daily','weekly','monthly')),
  prize          TEXT NOT NULL,
  prize_details  TEXT NOT NULL DEFAULT '',
  -- Retail value in US dollars, for tax forms. 0 if not set.
  prize_value    INTEGER NOT NULL DEFAULT 0,
  -- 'gift_card' or 'physical' (shown as a filter in the app).
  prize_type     TEXT NOT NULL DEFAULT 'gift_card' CHECK (prize_type IN ('gift_card','physical')),
  -- An Odds API sport key for a single-sport contest, or NULL for any sport.
  sport          TEXT,
  max_entries    INTEGER NOT NULL CHECK (max_entries > 0),
  starts_at      INTEGER NOT NULL,
  ends_at        INTEGER NOT NULL,
  created_at     INTEGER NOT NULL,
  winner_user_id TEXT REFERENCES users(id),
  finalized_at   INTEGER
);
CREATE INDEX IF NOT EXISTS competitions_time ON competitions(ends_at, starts_at);
CREATE INDEX IF NOT EXISTS competitions_start ON competitions(starts_at);

-- Messages players send from Contact us. The admin page lists them.
CREATE TABLE IF NOT EXISTS contact_messages (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  topic      TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  handled_at INTEGER
);
CREATE INDEX IF NOT EXISTS contact_messages_time ON contact_messages(created_at);

-- Joining is free. One row per player per contest, holding that contest's
-- points balance. Everyone starts at 0.
CREATE TABLE IF NOT EXISTS competition_entries (
  competition_id TEXT NOT NULL REFERENCES competitions(id),
  user_id        TEXT NOT NULL REFERENCES users(id),
  joined_at      INTEGER NOT NULL,
  balance        INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  PRIMARY KEY (competition_id, user_id)
);


-- One claim per winner of a finished contest (more than one only if they
-- are still tied after every tiebreaker; each gets the full prize). The claim form (legal name,
-- address, birth date, tax id) is encrypted, separate from the profile.
CREATE TABLE IF NOT EXISTS prize_claims (
  competition_id TEXT NOT NULL REFERENCES competitions(id),
  user_id        TEXT NOT NULL REFERENCES users(id),
  status         TEXT NOT NULL CHECK (status IN ('pending','submitted','verified','paid','ineligible','rejected')),
  data_enc       TEXT,
  skill_attempts INTEGER NOT NULL DEFAULT 0,
  note           TEXT NOT NULL DEFAULT '',
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  PRIMARY KEY (competition_id, user_id)
);

-- Push notifications already sent, so each goes out once.
CREATE TABLE IF NOT EXISTS notifications_sent (
  key      TEXT PRIMARY KEY,
  sent_at  INTEGER NOT NULL
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

/**
 * Databases from before points moved inside contests can't be converted, so
 * their player data is cleared (games, lines and Odds API usage are kept, so
 * no credits are spent reloading). This only matters before launch.
 */
function migrate(db: DB): void {
  const colsOf = (t: string) => (db.prepare(`SELECT name FROM pragma_table_info('${t}')`).all() as { name: string }[]).map((x) => x.name);
  const ledger = colsOf('ledger');
  if (ledger.length === 0) return; // fresh database
  if (ledger.includes('competition_id') && colsOf('users').includes('push_token') && colsOf('competitions').includes('prize_value')) {
    // Columns added later keep existing data.
    const comp = colsOf('competitions');
    if (!comp.includes('prize_type')) {
      db.exec("ALTER TABLE competitions ADD COLUMN prize_type TEXT NOT NULL DEFAULT 'gift_card' CHECK (prize_type IN ('gift_card','physical'))");
    }
    if (!comp.includes('sport')) db.exec('ALTER TABLE competitions ADD COLUMN sport TEXT');
    return;
  }
  db.exec('PRAGMA foreign_keys = OFF');
  for (const t of ['prize_claims', 'ledger', 'picks', 'ad_sessions', 'competition_entries', 'competitions', 'prizes', 'users']) db.exec(`DROP TABLE IF EXISTS ${t}`);
  db.exec('PRAGMA foreign_keys = ON');
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
