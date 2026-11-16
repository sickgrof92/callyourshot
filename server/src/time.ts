// Time-zone helpers built on Intl so we need no date library.

const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0 = Sunday
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      weekday: 'short',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function zonedParts(ms: number, tz: string): Parts {
  const out: Record<string, string> = {};
  for (const p of formatter(tz).formatToParts(new Date(ms))) out[p.type] = p.value;
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour),
    minute: Number(out.minute),
    second: Number(out.second),
    weekday: WEEKDAYS[out.weekday],
  };
}

function offsetMinutes(ms: number, tz: string): number {
  const p = zonedParts(ms, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / MINUTE);
}

/** Convert a wall-clock time in `tz` to epoch ms. Month is 1-based; day may overflow (it is normalised). */
export function zonedToEpoch(year: number, month: number, day: number, hour: number, tz: string): number {
  const guess = Date.UTC(year, month - 1, day, hour);
  const off1 = offsetMinutes(guess, tz);
  let t = guess - off1 * MINUTE;
  const off2 = offsetMinutes(t, tz);
  if (off2 !== off1) t = guess - off2 * MINUTE;
  return t;
}

function ymd(year: number, month: number, day: number): string {
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.toISOString().slice(0, 10);
}

export interface Window {
  key: string;
  start: number;
  end: number;
}

/** The "sports day" containing `ms`: from dayStartHour local time to the same hour the next day. */
export function sportsDay(ms: number, tz: string, dayStartHour: number): Window {
  const p = zonedParts(ms, tz);
  let { year, month, day } = p;
  if (p.hour < dayStartHour) {
    const prev = new Date(Date.UTC(year, month - 1, day - 1));
    year = prev.getUTCFullYear();
    month = prev.getUTCMonth() + 1;
    day = prev.getUTCDate();
  }
  return {
    key: ymd(year, month, day),
    start: zonedToEpoch(year, month, day, dayStartHour, tz),
    end: zonedToEpoch(year, month, day + 1, dayStartHour, tz),
  };
}

export type PeriodType = 'weekly' | 'monthly';

/** Leaderboard periods: weeks run Monday 00:00 to Monday 00:00 local time; months are calendar months. */
export function periodWindow(type: PeriodType, ms: number, tz: string): Window {
  const p = zonedParts(ms, tz);
  if (type === 'monthly') {
    return {
      key: `monthly:${p.year}-${String(p.month).padStart(2, '0')}`,
      start: zonedToEpoch(p.year, p.month, 1, 0, tz),
      end: zonedToEpoch(p.year, p.month + 1, 1, 0, tz),
    };
  }
  const daysSinceMonday = (p.weekday + 6) % 7;
  const mondayDay = p.day - daysSinceMonday;
  const start = zonedToEpoch(p.year, p.month, mondayDay, 0, tz);
  const end = zonedToEpoch(p.year, p.month, mondayDay + 7, 0, tz);
  const s = zonedParts(start, tz);
  return { key: `weekly:${ymd(s.year, s.month, s.day)}`, start, end };
}

/** Parse a period key ("weekly:2026-11-16" / "monthly:2026-11") back into its window. */
export function periodFromKey(key: string, tz: string): Window & { type: PeriodType } {
  const m = /^(weekly|monthly):(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(key);
  if (!m) throw new Error(`Bad period key: ${key}`);
  const type = m[1] as PeriodType;
  const day = m[4] ? Number(m[4]) : 1;
  // Noon on the given date is safely inside the period.
  const w = periodWindow(type, zonedToEpoch(Number(m[2]), Number(m[3]), day, 12, tz), tz);
  if (w.key !== key) throw new Error(`Period key ${key} is not the start of a period (did you mean ${w.key}?)`);
  return { ...w, type };
}

/** Billing period for the Odds API allowance, which resets on a fixed day of the month (UTC). */
export function billingPeriod(ms: number, resetDay: number): { start: number; end: number } {
  const d = new Date(ms);
  let y = d.getUTCFullYear();
  let m = d.getUTCMonth();
  let start = Date.UTC(y, m, resetDay);
  if (start > ms) {
    m -= 1;
    start = Date.UTC(y, m, resetDay);
  }
  const end = Date.UTC(new Date(start).getUTCFullYear(), new Date(start).getUTCMonth() + 1, resetDay);
  return { start, end };
}
