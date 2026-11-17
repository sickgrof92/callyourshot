// Who can play and win: residents of the US and Canada, except Quebec.
// Winners must be at least the age of majority where they live, and Canadian
// winners must answer a math skill-testing question before a prize is awarded.

export const COUNTRIES = ['US', 'CA'] as const;
export type Country = (typeof COUNTRIES)[number];

export const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA',
  'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX',
  'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
] as const;
export const CA_PROVINCES = ['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'] as const;

/** Places where the contests are void. */
export const EXCLUDED: Record<Country, string[]> = { US: [], CA: ['QC'] };

export type RegionCheck = { ok: true } | { ok: false; error: 'bad_region' | 'region_not_eligible' };

export function checkRegion(country: string, region: string): RegionCheck {
  const list: readonly string[] | undefined = country === 'US' ? US_STATES : country === 'CA' ? CA_PROVINCES : undefined;
  if (!list || !list.includes(region)) return { ok: false, error: 'bad_region' };
  if (EXCLUDED[country as Country].includes(region)) return { ok: false, error: 'region_not_eligible' };
  return { ok: true };
}

/** Minimum age to win, by place: the age of majority. */
export function ageOfMajority(country: Country, region: string): number {
  if (country === 'CA') return ['BC', 'NB', 'NL', 'NS', 'NT', 'NU', 'YT'].includes(region) ? 19 : 18;
  if (region === 'MS') return 21;
  if (region === 'AL' || region === 'NE') return 19;
  return 18;
}

/** Whole years between a YYYY-MM-DD birth date and `now`. */
export function ageOn(birthDate: string, now: number): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const born = new Date(Date.UTC(y, mo - 1, d));
  if (born.getUTCFullYear() !== y || born.getUTCMonth() !== mo - 1 || born.getUTCDate() !== d) return null;
  const today = new Date(now);
  let age = today.getUTCFullYear() - y;
  if (today.getUTCMonth() + 1 < mo || (today.getUTCMonth() + 1 === mo && today.getUTCDate() < d)) age--;
  return age >= 0 && age < 130 ? age : null;
}

/**
 * A skill-testing question for a Canadian winner, fixed per contest so the
 * server can check the answer without storing it: "a × b + c − d".
 */
export function skillQuestion(seed: string): { text: string; answer: number } {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const a = 3 + (h % 7);
  const b = 4 + ((h >>> 3) % 6);
  const c = 11 + ((h >>> 7) % 40);
  const d = 2 + ((h >>> 13) % 8);
  return { text: `${a} × ${b} + ${c} − ${d}`, answer: a * b + c - d };
}
