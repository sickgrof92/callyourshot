import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { openDb } from './db.ts';
import { HttpOddsApi } from './oddsApi.ts';
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
if (!cfg.adminToken) app.log.warn('ADMIN_TOKEN is not set: admin endpoints are disabled.');

await app.listen({ port: cfg.port, host: '0.0.0.0' });
