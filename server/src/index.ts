import { buildApp } from './app.ts';
import { ensureTestContests } from './competitions.ts';
import { loadConfig } from './config.ts';
import { openDb } from './db.ts';
import { HttpOddsApi } from './oddsApi.ts';
import { expoPushSender, notifyTick } from './notify.ts';
import { startScheduler } from './scheduler.ts';

const cfg = loadConfig();
const db = openDb(cfg.dbPath);
const oddsApi = cfg.oddsApiKey ? new HttpOddsApi(cfg.oddsApiKey, cfg.oddsApiBase, cfg.oddsRegions) : undefined;
const app = buildApp({ db, cfg, logger: true, oddsApi });

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
  for (const c of ensureTestContests(db, cfg, Date.now())) app.log.info({ id: c.id }, `Created the test contest "${c.name}".`);
  app.log.warn('SEED_TEST_CONTEST is on: test contests (a week-long one and a daily for the day) are made at startup. Set SEED_TEST_CONTEST=false before launch.');
}

// Push notifications: check once a minute for anything due.
const sendPush = expoPushSender(fetch, process.env.EXPO_ACCESS_TOKEN || undefined);
setInterval(() => {
  notifyTick(db, sendPush, Date.now()).catch((err) => app.log.error(err, 'push notifications failed'));
}, 60_000).unref();

await app.listen({ port: cfg.port, host: '0.0.0.0' });
