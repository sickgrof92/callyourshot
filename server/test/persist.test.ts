import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db.ts';
import { postgresStore, restoreSnapshot, startSnapshots, type SnapshotStore } from '../src/persist.ts';

const quiet = { info: () => {}, error: () => {} };

/** Keeps copies in memory, with the same "newer server wins" rule as Postgres. */
function memoryStore(): SnapshotStore & { saves: number } {
  let row: { data: Buffer; bootedAt: number } | null = null;
  return {
    saves: 0,
    async load() {
      return row?.data ?? null;
    },
    async save(data, bootedAt) {
      if (row && row.bootedAt > bootedAt) return false;
      row = { data, bootedAt };
      this.saves++;
      return true;
    },
    async close() {},
  };
}

const dir = () => mkdtempSync(join(tmpdir(), 'cys-persist-'));

async function roundTrip(store: SnapshotStore) {
  // First server: nothing saved yet.
  const path1 = join(dir(), 'a.db');
  expect(await restoreSnapshot(store, path1)).toBe(false);
  const db1 = openDb(path1);
  const s1 = startSnapshots(db1, store, path1, { bootedAt: 1, intervalMs: 60_000, log: quiet });
  db1.prepare("INSERT INTO notifications_sent (key, sent_at) VALUES ('kept', 1)").run();
  await s1.flush();
  s1.stop();

  // A restart on a fresh disk gets the data back.
  const path2 = join(dir(), 'b.db');
  expect(await restoreSnapshot(store, path2)).toBe(true);
  const db2 = openDb(path2);
  expect(db2.prepare("SELECT sent_at FROM notifications_sent WHERE key = 'kept'").get()).toEqual({ sent_at: 1 });

  // The old server (started earlier) can't overwrite the new one's copy during a deploy.
  const s2 = startSnapshots(db2, store, path2, { bootedAt: 2, intervalMs: 60_000, log: quiet });
  db2.prepare("INSERT INTO notifications_sent (key, sent_at) VALUES ('new', 2)").run();
  await s2.flush();
  db1.prepare("INSERT INTO notifications_sent (key, sent_at) VALUES ('stale', 3)").run();
  await s1.flush();
  const path3 = join(dir(), 'c.db');
  await restoreSnapshot(store, path3);
  const keys = (openDb(path3).prepare('SELECT key FROM notifications_sent ORDER BY key').all() as { key: string }[]).map((r) => r.key);
  expect(keys).toEqual(['kept', 'new']);
  s2.stop();
}

describe('keeping the database across restarts', () => {
  it('restores the latest copy, and only uploads when something changed', async () => {
    const store = memoryStore();
    await roundTrip(store);
    const before = store.saves;
    const path = join(dir(), 'd.db');
    await restoreSnapshot(store, path);
    const db = openDb(path);
    const s = startSnapshots(db, store, path, { bootedAt: 3, intervalMs: 60_000, log: quiet });
    await s.flush(); // nothing changed since the restore
    expect(store.saves).toBe(before);
    s.stop();
  });

  it('refuses to start empty if the copy cannot be read', async () => {
    const broken: SnapshotStore = { load: () => Promise.reject(new Error('down')), save: async () => true, close: async () => {} };
    await expect(restoreSnapshot(broken, join(dir(), 'e.db'))).rejects.toThrow('down');
  });

  // Runs against a real Postgres when TEST_DATABASE_URL is set.
  it.skipIf(!process.env.TEST_DATABASE_URL)('works with Postgres', async () => {
    const url = process.env.TEST_DATABASE_URL!;
    const store = postgresStore(url, () => {});
    const pg = (await import('pg')).default;
    const c = new pg.Client(url);
    await c.connect();
    await c.query('DROP TABLE IF EXISTS cys_snapshot');
    await c.end();
    await roundTrip(store);
    await store.close();
  });
});
