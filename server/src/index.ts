import { buildApp } from './app.ts';
import { ensureTestContest } from './competitions.ts';
import { loadConfig } from './config.ts';
import { openDb } from './db.ts';
import { HttpOddsApi } from './oddsApi.ts';
import { expoPushSender, notifyTick } from './notify.ts';
import { startScheduler } from './scheduler.ts';

const cfg = loadConfig();
const db = openDb(cfg.dbPath);
const app = buildApp({ db, cfg, logger: true });

if (cfg.schedulerEnabled) {
  if (!cfg.oddsApiKey) {
    app.log.warn('ODDS_API_KEY is not set: the line refresh scheduler is off and no lines will load.');
  } else {
    const api = new HttpOddsApi(cfg.oddsApiKey, cfg.oddsApiBase, cfg.oddsRegions);
    startScheduler(db, cfg, api, app.log);
  }
}
if (cfg.adProvider === 'stub') app.log.warn('AD_PROVIDER=stub: the app completes ads itself. Fine for testing; set AD_PROVIDER=admob before launch.');
if (cfg.authMode === 'stub') app.log.warn('AUTH_MODE=stub: sign-in is not verified. Fine for testing; set AUTH_MODE=live before launch.');
if (!cfg.claimsKey) app.log.warn('CLAIMS_KEY is not set: winners cannot submit prize claims.');
if (!cfg.adminToken) app.log.warn('ADMIN_TOKEN is not set: admin endpoints are disabled.');
if (cfg.seedTestContest) {
  const made = ensureTestContest(db, cfg, Date.now());
  if (made) app.log.info({ id: made.id }, 'Created the test contest "Test week: all sports".');
  app.log.warn('SEED_TEST_CONTEST is on: a test contest is made whenever none is live or upcoming. Set SEED_TEST_CONTEST=false before launch.');
}

// Push notifications: check once a minute for anything due.
const sendPush = expoPushSender(fetch, process.env.EXPO_ACCESS_TOKEN || undefined);
setInterval(() => {
  notifyTick(db, sendPush, Date.now()).catch((err) => app.log.error(err, 'push notifications failed'));
}, 60_000).unref();

await app.listen({ port: cfg.port, host: '0.0.0.0' });
