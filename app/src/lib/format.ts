import type { Market, Selection } from './api';

export const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

/** Short label for a line, e.g. "Knicks -3.5", "Over 221.5", "Knicks to win". */
export function lineLabel(market: Market, selection: Selection, point: number | null, home: string, away: string): string {
  const team = selection === 'home' ? home : away;
  if (market === 'moneyline') return `${team} to win`;
  if (market === 'spread') return `${team} ${signed(point ?? 0)}`;
  return `${selection === 'over' ? 'Over' : 'Under'} ${point ?? ''}`;
}

export const marketName: Record<Market, string> = { moneyline: 'Winner', spread: 'Spread', total: 'Total' };

export function gameTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

export function ago(iso: string | null): string {
  if (!iso) return 'not loaded yet';
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  return `${d} ${d === 1 ? 'day' : 'days'} ago`;
}

export function countdown(iso: string): string {
  const ms = Date.parse(iso) - Date.now();
  if (ms <= 0) return 'ended';
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  return d > 0 ? `${d}d ${h}h left` : `${h}h ${Math.floor((ms % 3600000) / 60000)}m left`;
}

/** "Starts in 5h 20m" / "Ends in 2d 4h" / "Ended". */
export function contestClock(status: 'upcoming' | 'live' | 'ended', startsAt: string, endsAt: string): string {
  if (status === 'ended') return 'Ended';
  const target = status === 'upcoming' ? startsAt : endsAt;
  const ms = Date.parse(target) - Date.now();
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.max(0, Math.floor((ms % 3600000) / 60000));
  const left = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
  return `${status === 'upcoming' ? 'Starts in' : 'Ends in'} ${left}`;
}

export function contestDates(startsAt: string, endsAt: string): string {
  const f = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return `${f(startsAt)} to ${f(endsAt)}`;
}
