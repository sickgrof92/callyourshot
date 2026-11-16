// Turns Odds API responses into our cached events and lines.

import type { DB } from './db.ts';
import type { Bookmaker, EventSummary, OddsEvent, ScoreEvent } from './oddsApi.ts';

export type MarketKind = 'moneyline' | 'spread' | 'total';
export type Selection = 'home' | 'away' | 'over' | 'under';

export interface LineRow {
  event_id: string;
  market: MarketKind;
  selection: Selection;
  point: number | null;
  price: number;
  book: string;
  fetched_at: number;
}

const API_MARKET: Record<string, MarketKind> = { h2h: 'moneyline', spreads: 'spread', totals: 'total' };

export function upsertEvents(db: DB, events: EventSummary[], now: number): void {
  const stmt = db.prepare(`
    INSERT INTO events (id, sport, home_team, away_team, commence_time, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      home_team = excluded.home_team,
      away_team = excluded.away_team,
      commence_time = excluded.commence_time,
      updated_at = excluded.updated_at
  `);
  for (const e of events) {
    const t = Date.parse(e.commence_time);
    if (!Number.isFinite(t)) continue;
    stmt.run(e.id, e.sport_key, e.home_team, e.away_team, t, now);
  }
}

/** Pick one book per event so every user sees the same consistent set of lines. */
export function chooseBook(bookmakers: Bookmaker[], preferred: string[]): Bookmaker | null {
  for (const key of preferred) {
    const b = bookmakers.find((x) => x.key === key && x.markets.length > 0);
    if (b) return b;
  }
  // Otherwise the book offering the most markets.
  const sorted = [...bookmakers].filter((b) => b.markets.length > 0).sort((a, b) => b.markets.length - a.markets.length);
  return sorted[0] ?? null;
}

export function linesFromBook(event: OddsEvent, book: Bookmaker, now: number): LineRow[] {
  const rows: LineRow[] = [];
  for (const m of book.markets) {
    const market = API_MARKET[m.key];
    if (!market) continue;
    for (const o of m.outcomes) {
      let selection: Selection | null = null;
      if (market === 'total') {
        if (o.name.toLowerCase() === 'over') selection = 'over';
        else if (o.name.toLowerCase() === 'under') selection = 'under';
      } else if (o.name === event.home_team) selection = 'home';
      else if (o.name === event.away_team) selection = 'away';
      if (!selection) continue;
      if (market !== 'moneyline' && typeof o.point !== 'number') continue;
      if (!Number.isFinite(o.price) || o.price === 0) continue;
      rows.push({
        event_id: event.id,
        market,
        selection,
        point: market === 'moneyline' ? null : o.point!,
        price: Math.round(o.price),
        book: book.key,
        fetched_at: now,
      });
    }
  }
  return rows;
}

export function ingestOdds(db: DB, events: OddsEvent[], preferredBooks: string[], now: number): number {
  upsertEvents(db, events, now);
  const del = db.prepare('DELETE FROM lines WHERE event_id = ?');
  const ins = db.prepare(
    'INSERT INTO lines (event_id, market, selection, point, price, book, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  const touch = db.prepare('UPDATE events SET lines_updated_at = ? WHERE id = ?');
  let count = 0;
  for (const e of events) {
    // Games already under way keep their last pre-game lines; nobody can pick them anyway.
    if (Date.parse(e.commence_time) <= now) continue;
    const book = chooseBook(e.bookmakers ?? [], preferredBooks);
    if (!book) continue;
    const rows = linesFromBook(e, book, now);
    if (rows.length === 0) continue;
    del.run(e.id);
    for (const r of rows) ins.run(r.event_id, r.market, r.selection, r.point, r.price, r.book, r.fetched_at);
    touch.run(now, e.id);
    count += rows.length;
  }
  return count;
}

/** Store final scores. Returns the ids of events that are now complete. */
export function applyScores(db: DB, scores: ScoreEvent[], now: number): string[] {
  const done: string[] = [];
  const upd = db.prepare(
    'UPDATE events SET completed = 1, home_score = ?, away_score = ?, updated_at = ? WHERE id = ? AND completed = 0',
  );
  for (const s of scores) {
    if (!s.completed || !s.scores) continue;
    const home = s.scores.find((x) => x.name === s.home_team);
    const away = s.scores.find((x) => x.name === s.away_team);
    if (!home || !away) continue;
    const hs = Number(home.score);
    const as = Number(away.score);
    if (!Number.isFinite(hs) || !Number.isFinite(as)) continue;
    const exists = db.prepare('SELECT 1 FROM events WHERE id = ?').get(s.id);
    if (!exists) continue; // nobody could have picked an event we never cached
    upd.run(hs, as, now, s.id);
    done.push(s.id);
  }
  return done;
}
