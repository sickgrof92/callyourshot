// Contest filters for the Contests screen: the choices, their labels, and how
// they turn into a server query. Filtering and paging happen on the server.

import type { ContestQuery, PrizeType } from './api';

export type Show = 'open' | 'live' | 'upcoming' | 'mine';
export type Starts = 'any' | 'today' | 'tomorrow' | 'week';

export interface Filters {
  sort: 'soonest' | 'popular' | 'ending';
  show: Show;
  /** '' = any sport; 'any' = only contests open to every sport. */
  sport: string;
  size: '' | 'small' | 'medium' | 'large';
  length: '' | 'day' | 'week' | 'month';
  starts: Starts;
  prizeType: '' | PrizeType;
}

export const DEFAULT_FILTERS: Filters = { sort: 'soonest', show: 'open', sport: '', size: '', length: '', starts: 'any', prizeType: '' };

export const SORT_OPTIONS: [Filters['sort'], string][] = [
  ['soonest', 'Starting soonest'],
  ['popular', 'Most players'],
  ['ending', 'Ending soonest'],
];
export const SHOW_OPTIONS: [Show, string][] = [
  ['open', 'All'],
  ['live', 'Live now'],
  ['upcoming', 'Coming up'],
  ['mine', "I'm in"],
];
export const SIZE_OPTIONS: [Filters['size'], string][] = [
  ['', 'Any size'],
  ['small', 'Up to 100'],
  ['medium', '101 to 1,000'],
  ['large', 'Over 1,000'],
];
export const LENGTH_OPTIONS: [Filters['length'], string][] = [
  ['', 'Any length'],
  ['day', '1 day'],
  ['week', 'Up to a week'],
  ['month', 'Longer'],
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
  if (f.sport) q.sport = f.sport;
  if (f.size) q.size = f.size;
  if (f.length) q.length = f.length;
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
  if (f.sport) out.push({ key: 'sport', text: f.sport === 'any' ? 'All-sport contests' : sportLabel(f.sport) });
  if (f.size) out.push({ key: 'size', text: label(SIZE_OPTIONS, f.size) + ' players' });
  if (f.length) out.push({ key: 'length', text: label(LENGTH_OPTIONS, f.length) });
  if (f.starts !== 'any') out.push({ key: 'starts', text: 'Starts ' + label(STARTS_OPTIONS, f.starts).toLowerCase() });
  if (f.prizeType) out.push({ key: 'prizeType', text: label(PRIZE_OPTIONS, f.prizeType) });
  return out;
}

export const sortLabel = (f: Filters) => label(SORT_OPTIONS, f.sort);
