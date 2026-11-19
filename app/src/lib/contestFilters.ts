// Contest filters for the Contests screen: the choices, their labels, and how
// they turn into a server query. Filtering and paging happen on the server.

import type { ContestQuery, PrizeType } from './api';

export type Show = 'open' | 'live' | 'upcoming' | 'ended';
export type Starts = 'any' | 'today' | 'tomorrow' | 'week';

export interface Filters {
  sort: 'soonest' | 'popular' | 'ending';
  show: Show;
  /** Only contests I entered. Combines with any Show choice. */
  entered: boolean;
  /** '' = any sport; 'any' = only contests open to every sport. */
  sport: string;
  /** Max-players range, as typed ('' = no limit). */
  sizeMin: string;
  sizeMax: string;
  /** Length in days; LENGTH_MAX means "30+" (no upper limit). */
  lengthMin: number;
  lengthMax: number;
  starts: Starts;
  prizeType: '' | PrizeType;
}

/** The length slider runs from 1 day to 30+. */
export const LENGTH_MIN = 1;
export const LENGTH_MAX = 30;

export const DEFAULT_FILTERS: Filters = {
  sort: 'soonest',
  show: 'open',
  entered: false,
  sport: '',
  sizeMin: '',
  sizeMax: '',
  lengthMin: LENGTH_MIN,
  lengthMax: LENGTH_MAX,
  starts: 'any',
  prizeType: '',
};

/** Accept filters saved by an older version of the app. */
export function fromSaved(raw: Partial<Filters> & Record<string, unknown>): Filters {
  const f = { ...DEFAULT_FILTERS };
  for (const k of Object.keys(DEFAULT_FILTERS) as (keyof Filters)[]) {
    if (raw[k] !== undefined && typeof raw[k] === typeof DEFAULT_FILTERS[k]) (f as Record<string, unknown>)[k] = raw[k];
  }
  // Older versions had "Entered" as one of the Show choices.
  if ((raw.show as string | undefined) === 'mine') {
    f.show = 'open';
    f.entered = true;
  }
  if (!SHOW_OPTIONS.some(([k]) => k === f.show)) f.show = 'open';
  return f;
}

export const lengthText = (d: number) => (d >= LENGTH_MAX ? `${LENGTH_MAX}+ days` : d === 1 ? '1 day' : `${d} days`);
const num = (s: string) => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : undefined);

export const SORT_OPTIONS: [Filters['sort'], string][] = [
  ['soonest', 'Starting soonest'],
  ['popular', 'Most players'],
  ['ending', 'Ending soonest'],
];
export const SHOW_OPTIONS: [Show, string][] = [
  ['open', 'All'],
  ['live', 'Live now'],
  ['upcoming', 'Coming up'],
  ['ended', 'Ended'],
];
export const STARTS_OPTIONS: [Starts, string][] = [
  ['any', 'Any time'],
  ['today', 'Today'],
  ['tomorrow', 'Tomorrow'],
  ['week', 'Next 7 days'],
];
export const PRIZE_OPTIONS: [Filters['prizeType'], string][] = [
  ['', 'Any prize'],
  ['gift_card', 'Gift cards'],
  ['physical', 'Physical prizes'],
];

const label = <T,>(opts: [T, string][], v: T) => opts.find(([k]) => k === v)?.[1] ?? String(v);

/** Start of the local day `days` from today. */
function localDay(days: number, now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
}

export function toQuery(f: Filters, now = new Date()): ContestQuery {
  const q: ContestQuery = { sort: f.sort, status: f.show };
  if (f.entered) q.entered = 1;
  if (f.sport) q.sport = f.sport;
  const lo = num(f.sizeMin);
  const hi = num(f.sizeMax);
  if (lo !== undefined) q.sizeMin = lo;
  if (hi !== undefined) q.sizeMax = hi;
  if (f.lengthMin > LENGTH_MIN) q.lengthMin = f.lengthMin;
  if (f.lengthMax < LENGTH_MAX) q.lengthMax = f.lengthMax;
  if (f.prizeType) q.prizeType = f.prizeType;
  if (f.starts !== 'any') {
    const [from, to] = { today: [0, 1], tomorrow: [1, 2], week: [0, 7] }[f.starts];
    q.startFrom = localDay(from, now).toISOString();
    q.startTo = localDay(to, now).toISOString();
  }
  return q;
}

/** The filters that differ from the defaults, as removable chips. */
export function activeChips(f: Filters, sportLabel: (key: string) => string): { key: keyof Filters; text: string }[] {
  const out: { key: keyof Filters; text: string }[] = [];
  if (f.show !== 'open') out.push({ key: 'show', text: label(SHOW_OPTIONS, f.show) });
  if (f.entered) out.push({ key: 'entered', text: 'Entered' });
  if (f.sport) out.push({ key: 'sport', text: f.sport === 'any' ? 'All-sport contests' : sportLabel(f.sport) });
  const lo = num(f.sizeMin);
  const hi = num(f.sizeMax);
  if (lo !== undefined || hi !== undefined) {
    const n = (x: number) => x.toLocaleString();
    out.push({
      key: 'sizeMin',
      text: lo !== undefined && hi !== undefined ? `${n(lo)}–${n(hi)} players` : lo !== undefined ? `${n(lo)}+ players` : `Up to ${n(hi!)} players`,
    });
  }
  if (f.lengthMin > LENGTH_MIN || f.lengthMax < LENGTH_MAX) {
    const text =
      f.lengthMin === f.lengthMax
        ? lengthText(f.lengthMin)
        : f.lengthMax >= LENGTH_MAX
          ? `${f.lengthMin}+ days`
          : f.lengthMin <= LENGTH_MIN
            ? `Up to ${lengthText(f.lengthMax)}`
            : `${f.lengthMin}–${lengthText(f.lengthMax)}`;
    out.push({ key: 'lengthMin', text });
  }
  if (f.starts !== 'any') out.push({ key: 'starts', text: 'Starts ' + label(STARTS_OPTIONS, f.starts).toLowerCase() });
  if (f.prizeType) out.push({ key: 'prizeType', text: label(PRIZE_OPTIONS, f.prizeType) });
  return out;
}

export const sortLabel = (f: Filters) => label(SORT_OPTIONS, f.sort);
