// How long games take. The scheduler uses the typical length to know when a
// final score could exist; contests use it (plus a buffer for overtime and
// delays) so a pick only counts if its game should finish before the contest ends.

import { HOUR } from './time.ts';

const MIN = 60_000;

/** Rough real-world game lengths, from scheduled start to final. */
export const GAME_LENGTH: Record<string, number> = {
  americanfootball_nfl: 3 * HOUR + 10 * MIN,
  americanfootball_ncaaf: 3 * HOUR + 20 * MIN,
  basketball_nba: 2 * HOUR + 20 * MIN,
  basketball_ncaab: 2 * HOUR,
  icehockey_nhl: 2 * HOUR + 30 * MIN,
};
const DEFAULT_GAME_LENGTH = 3 * HOUR;
export const gameLength = (sport: string) => GAME_LENGTH[sport] ?? DEFAULT_GAME_LENGTH;

/** Room for overtime, rain or TV delays when deciding if a game fits in a contest. */
export const GAME_END_BUFFER = HOUR;

/** When the game should be over, with room for delays. */
export const expectedEnd = (sport: string, commenceTime: number) => commenceTime + gameLength(sport) + GAME_END_BUFFER;
