// Keeps the database when the server restarts.
//
// Render's free plan has no disk that survives a restart, redeploy or sleep.
// When DATABASE_URL is set (a free hosted Postgres such as Neon), the server
// keeps a compressed copy of its whole SQLite database there:
//  - at startup, before opening the database, the latest copy is downloaded;
//  - while running, a new copy is uploaded every minute if anything changed;
//  - when Render stops the server (SIGTERM), a last copy is uploaded first.
// The app's queries stay on fast local SQLite; Postgres only stores the copy.
//
// During a deploy the old and new servers overlap for a moment. Each copy is
// stamped with when its server started, and an older server can never
// overwrite a copy from a newer one.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import pg from 'pg';
import type { DB } from './db.ts';

/** Where copies are kept. Postgres in production; a fake in tests. */
export interface SnapshotStore {
  load(): Promise<Buffer | null>;
  /** Save unless a server that started later has already saved. Returns false if it was skipped. */
  save(data: Buffer, bootedAt: number): Promise<boolean>;
  close(): Promise<void>;
}

export function postgresStore(url: string, onError: (err: Error) => void): SnapshotStore {
  // Hosted Postgres URLs say sslmode=require; pg treats that as verify-full anyway, so say so and skip its warning.
  const connectionString = url.replace(/sslmode=(require|prefer|verify-ca)\b/, 'sslmode=verify-full');
  const pool = new pg.Pool({ connectionString, max: 1, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 20_000 });
  // Hosted Postgres closes idle connections (e.g. Neon when it scales to zero). That must not crash the server.
  pool.on('error', onError);
  let ready: Promise<unknown> | null = null;
  const init = () =>
    (ready ??= pool.query(
      'CREATE TABLE IF NOT EXISTS cys_snapshot (id INTEGER PRIMARY KEY, data BYTEA NOT NULL, booted_at BIGINT NOT NULL, saved_at TIMESTAMPTZ NOT NULL DEFAULT now())',
    ).catch((err) => {
      ready = null;
      throw err;
    }));
  return {
    async load() {
      await init();
      const r = await pool.query<{ data: Buffer }>('SELECT data FROM cys_snapshot WHERE id = 1');
      return r.rows[0]?.data ?? null;
    },
    async save(data, bootedAt) {
      await init();
      const r = await pool.query(
        `INSERT INTO cys_snapshot (id, data, booted_at, saved_at) VALUES (1, $1, $2, now())
         ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, booted_at = EXCLUDED.booted_at, saved_at = now()
         WHERE cys_snapshot.booted_at <= EXCLUDED.booted_at`,
        [data, bootedAt],
      );
      return (r.rowCount ?? 0) > 0;
    },
    close: () => pool.end(),
  };
}

/**
 * Put the saved copy at `path` before the database is opened. Returns true if
 * there was one. Throws if the store can't be reached: starting empty and then
 * saving would overwrite the good copy, so it's better to fail and be retried.
 */
export async function restoreSnapshot(store: SnapshotStore, path: string): Promise<boolean> {
  const data = await store.load();
  if (!data) return false;
  mkdirSync(dirname(path), { recursive: true });
  for (const f of [path, `${path}-wal`, `${path}-shm`]) rmSync(f, { force: true });
  writeFileSync(path, gunzipSync(data));
  return true;
}

/** A compressed, consistent copy of the open database. */
export function snapshotBytes(db: DB, path: string): Buffer {
  const tmp = `${path}.snapshot`;
  rmSync(tmp, { force: true });
  db.prepare('VACUUM INTO ?').run(tmp);
  try {
    return gzipSync(readFileSync(tmp));
  } finally {
    rmSync(tmp, { force: true });
  }
}

export interface Snapshotter {
  /** Upload now if anything changed since the last upload. */
  flush(): Promise<void>;
  stop(): void;
}

export function startSnapshots(
  db: DB,
  store: SnapshotStore,
  path: string,
  opts: { bootedAt: number; intervalMs: number; log: { info: (msg: string) => void; error: (err: unknown, msg: string) => void } },
): Snapshotter {
  const changes = () => (db.prepare('SELECT total_changes() AS n').get() as { n: number }).n;
  // Everything up to now came from the restored copy (or is the empty schema).
  let saved = changes();
  let running: Promise<void> | null = null;

  const flush = (): Promise<void> => {
    if (running) return running.then(flush);
    const now = changes();
    if (now === saved) return Promise.resolve();
    const data = snapshotBytes(db, path);
    running = store
      .save(data, opts.bootedAt)
      .then((ok) => {
        saved = now;
        if (!ok) opts.log.info('A newer server has saved the database since this one started, so this copy was not saved.');
      })
      .catch((err) => opts.log.error(err, 'saving the database copy failed; will retry'))
      .finally(() => {
        running = null;
      });
    return running;
  };

  const timer = setInterval(() => void flush(), opts.intervalMs);
  timer.unref();
  return { flush, stop: () => clearInterval(timer) };
}

