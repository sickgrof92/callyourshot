// Runtime configuration. Everything comes from environment variables so that
// secrets (the Odds API key, the admin token, ad keys) never live in the repo.

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Env var ${name} must be a number, got "${raw}"`);
  return n;
}

function str(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? fallback : raw;
}

function list(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

export interface Config {
  port: number;
  dbPath: string;
  adminToken: string;
  timeZone: string;
  /** Hour (local, in timeZone) at which a new "sports day" starts. Late West Coast games belong to the previous day. */
  dayStartHour: number;

  oddsApiKey: string;
  oddsApiBase: string;
  oddsRegions: string;
  preferredBooks: string[];
  sports: string[];

  monthlyCredits: number;
  reserveFraction: number;
  hardFloorFraction: number;
  /** Day of month (UTC) on which the Odds API credit allowance resets. */
  billingResetDay: number;

  schedulerEnabled: boolean;
  schedulerTickSeconds: number;

  adProvider: 'stub' | 'admob';
  /** Ads for points allowed per day (including a new player's first), and only while out of points. */
  pointsAdsPerDay: number;

  /** Gap between score checks once a game with pending picks should be over (normal mode, not the free-tier lean mode). */
  scoresIntervalMs: number;
  minPickPoints: number;
  maxPickPoints: number;

  /** stub = accept fake sign-in tokens (Expo Go, testing); live = verify real Apple/Google tokens. */
  authMode: 'stub' | 'live';
  /** Apple: the app's bundle id (and a Services ID if you add web sign-in). */
  appleClientIds: string[];
  /** Google: the OAuth client ids for iOS, Android and web. */
  googleClientIds: string[];

  /** Secret that encrypts prize claim forms. Prize claims are refused until it is set. */
  claimsKey: string;
  /** Version of the Official Rules and Privacy Policy players agree to at sign-up. */
  termsVersion: string;
  /** AdMob rewarded ad unit ids (the number after the slash). If set, callbacks for other units are refused. */
  admobAdUnits: string[];
}

export function loadConfig(): Config {
  const adProvider = str('AD_PROVIDER', 'stub');
  if (adProvider !== 'stub' && adProvider !== 'admob') {
    throw new Error('AD_PROVIDER must be "stub" or "admob"');
  }
  const authMode = str('AUTH_MODE', 'stub');
  if (authMode !== 'stub' && authMode !== 'live') throw new Error('AUTH_MODE must be "stub" or "live"');
  return {
    port: num('PORT', 8080),
    dbPath: str('DB_PATH', './data/callyourshot.db'),
    adminToken: str('ADMIN_TOKEN', ''),
    timeZone: str('APP_TIME_ZONE', 'America/New_York'),
    dayStartHour: num('DAY_START_HOUR', 5),

    oddsApiKey: str('ODDS_API_KEY', ''),
    oddsApiBase: str('ODDS_API_BASE', 'https://api.the-odds-api.com/v4'),
    oddsRegions: str('ODDS_API_REGIONS', 'us'),
    preferredBooks: list('ODDS_API_PREFERRED_BOOKS', ['draftkings', 'fanduel', 'betmgm', 'caesars']),
    sports: list('SPORTS', [
      'americanfootball_nfl',
      'americanfootball_ncaaf',
      'basketball_nba',
      'basketball_ncaab',
      'icehockey_nhl',
    ]),

    // Free tier is 500; the $30 plan is 20000. This is the only setting to change when upgrading.
    monthlyCredits: num('ODDS_API_MONTHLY_CREDITS', 500),
    reserveFraction: num('ODDS_API_RESERVE_FRACTION', 0.1),
    hardFloorFraction: num('ODDS_API_HARD_FLOOR_FRACTION', 0.01),
    billingResetDay: num('ODDS_API_RESET_DAY', 1),

    schedulerEnabled: str('SCHEDULER_ENABLED', 'true') === 'true',
    schedulerTickSeconds: num('SCHEDULER_TICK_SECONDS', 60),

    adProvider,
    pointsAdsPerDay: num('POINTS_ADS_PER_DAY', 5),

    // 30 minutes suits small plans; use 5 on a paid Odds API plan so picks grade within minutes.
    scoresIntervalMs: num('SCORES_INTERVAL_MINUTES', 30) * 60_000,
    minPickPoints: num('MIN_PICK_POINTS', 10),
    maxPickPoints: num('MAX_PICK_POINTS', 500),

    authMode,
    appleClientIds: list('APPLE_CLIENT_IDS', ['com.callyourshot.app']),
    googleClientIds: list('GOOGLE_CLIENT_IDS', []),

    claimsKey: str('CLAIMS_KEY', ''),
    termsVersion: str('TERMS_VERSION', '2026-11-16'),
    admobAdUnits: list('ADMOB_AD_UNIT_IDS', []),
  };
}

/** Points granted by a points video. Fixed on purpose: it never depends on ad revenue. */
export const AD_REWARD_POINTS = 10;

export const SPORT_LABELS: Record<string, string> = {
  americanfootball_nfl: 'NFL',
  americanfootball_ncaaf: 'College Football',
  basketball_nba: 'NBA',
  basketball_ncaab: 'College Basketball',
  icehockey_nhl: 'NHL',
};
