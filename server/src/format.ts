const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

/** Short label for a pick, e.g. "Knicks -3.5", "Over 221.5", "Knicks to win". Matches the app. */
export function lineLabel(market: string, selection: string, point: number | null, home: string, away: string): string {
  const team = selection === 'home' ? home : away;
  if (market === 'moneyline') return `${team} to win`;
  if (market === 'spread') return `${team} ${signed(point ?? 0)}`;
  return `${selection === 'over' ? 'Over' : 'Under'} ${point ?? ''}`;
}
