import { buildApp } from './app.ts';
import { backfillStartingPoints, ensureTestContests } from './competitions.ts';
import { loadConfig } from './config.ts';
import { openDb } from './db.ts';
import { postgresStore, restoreSnapshot, startSnapshots, type Snapshotter } from './persist.ts';
import { HttpOddsApi } from './oddsApi.ts';
import { expoPushSender, notifyTick } from './notify.ts';
import { startScheduler } from './scheduler.ts';

const cfg = loadConfig();
const bootedAt = Date.now();

// Bring back the saved copy of the database (free hosting has no lasting disk).
const store = cfg.databaseUrl ? postgresStore(cfg.databaseUrl, (err) => console.error('database copy connection error', err.message)) : null;
let restored = false;
if (store) {
  if (cfg.dbPath === ':memory:') throw new Error('DATABASE_URL needs DB_PATH to be a file.');
  restored = await restoreSnapshot(store, cfg.dbPath);
}
const db = openDb(cfg.dbPath);
const oddsApi = cfg.oddsApiKey ? new HttpOddsApi(cfg.oddsApiKey, cfg.oddsApiBase, cfg.oddsRegions) : undefined;
const app = buildApp({ db, cfg, logger: true, oddsApi });
if (store) app.log.info(restored ? 'Restored the saved copy of the database.' : 'No saved copy of the database yet: starting fresh.');
else app.log.warn('DATABASE_URL is not set: on hosting without a lasting disk, all data is lost when the server restarts.');
// Start counting changes now, so test contests made below are saved too.
let snapshots: Snapshotter | null = null;
if (store) {
  snapshots = startSnapshots(db, store, cfg.dbPath, {
    bootedAt,
    intervalMs: cfg.snapshotSeconds * 1000,
    log: { info: (m) => app.log.info(m), error: (err, m) => app.log.error(err, m) },
  });
}
// Players who joined before starting points were credited on joining (and never watched the old video) get them now.
const backfilled = backfillStartingPoints(db, Date.now());
if (backfilled) app.log.info(`Credited starting points to ${backfilled} existing contest entries.`);


if (cfg.schedulerEnabled) {
  if (!oddsApi) {
    app.log.warn('ODDS_API_KEY is not set: the line refresh scheduler is off and no lines will load.');
  } else {
    startScheduler(db, cfg, oddsApi, app.log);
  }
}
if (cfg.adProvider === 'stub') app.log.warn('AD_PROVIDER=stub: the app completes ads itself. Fine for testing; set AD_PROVIDER=admob before launch.');
if (cfg.authMode === 'stub') app.log.warn('AUTH_MODE=stub: sign-in is not verified. Fine for testing; set AUTH_MODE=live before launch.');
if (!cfg.claimsKey) app.log.warn('CLAIMS_KEY is not set: winners cannot submit prize claims.');
if (!cfg.adminToken) app.log.warn('ADMIN_TOKEN is not set: admin endpoints are disabled.');
if (cfg.seedTestContest) {
  const seed = () => {
    for (const c of ensureTestContests(db, cfg, Date.now())) app.log.info({ id: c.id }, `Created the test contest "${c.name}".`);
  };
  seed();
  // The server can now stay up for days, so check for the next day's test contest every 15 minutes.
  setInterval(seed, 15 * 60_000).unref();
  app.log.warn('SEED_TEST_CONTEST is on: test contests (a week-long one and a daily for the day) are made at startup. Set SEED_TEST_CONTEST=false before launch.');
}

// Push notifications: check once a minute for anything due.
const sendPush = expoPushSender(fetch, process.env.EXPO_ACCESS_TOKEN || undefined);
setInterval(() => {
  notifyTick(db, sendPush, Date.now()).catch((err) => app.log.error(err, 'push notifications failed'));
}, 60_000).unref();

// Render sends SIGTERM before stopping the server (redeploy, restart, sleep): save a last copy first.
let stopping = false;
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.once(sig, () => {
    if (stopping) return;
    stopping = true;
    app.log.info(`${sig}: saving and shutting down.`);
    void (async () => {
      try {
        snapshots?.stop();
        await app.close();
        await snapshots?.flush();
        await store?.close();
      } catch (err) {
        app.log.error(err, 'shutdown failed');
      }
      process.exit(0);
    })();
  });
}

await app.listen({ port: cfg.port, host: '0.0.0.0' });
