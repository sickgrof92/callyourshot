// Flags likely duplicate people for the admin to review. Nothing is blocked
// automatically: the admin decides, usually when a flagged player wins.
//
// Two kinds of evidence:
//  - Accounts: the same birth date and state/province, plus a similar email or
//    display name (e.g. mike.r+2@gmail.com and miker@gmail.com, or hoops_mike
//    and hoops_mike2). Sharing a birthday and state alone is common in big
//    states, so that alone isn't flagged.
//  - Prize claims: the same legal name, birth date and state/province on
//    different accounts' claims is almost certainly one person. A claim whose
//    birth date differs from the one given at sign-up is flagged too.

import type { Config } from './config.ts';
import { listClaims } from './claims.ts';
import type { DB } from './db.ts';

/** Email local part with dots, +tags and digits removed: "Mike.R+2" and "miker7" both become "miker". */
export function emailBase(email: string | null): string {
  if (!email) return '';
  const local = email.toLowerCase().split('@')[0] ?? '';
  return local.split('+')[0].replace(/[^a-z]/g, '');
}

/** Display name with digits, dots and underscores removed. */
export function nameBase(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, '');
}

/** Legal name for matching: lower case, letters and spaces only, single spaces. */
export function legalNameKey(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

interface UserRow {
  id: string;
  display_name: string;
  email: string | null;
  phone: string | null;
  country: string | null;
  region: string | null;
  birth_date: string | null;
  created_at: number;
}

export interface DuplicateGroup {
  /** 'claim' = same legal name, birth date and state on prize claims (strong); 'account' = same birth date and state plus similar email or name. */
  kind: 'claim' | 'account';
  reason: string;
  players: { id: string; displayName: string; email: string | null; phone: string | null; region: string | null; birthDate: string | null; joined: string }[];
}

export function duplicateGroups(db: DB, cfg: Config): DuplicateGroup[] {
  const users = db
    .prepare('SELECT id, display_name, email, phone, country, region, birth_date, created_at FROM users WHERE birth_date IS NOT NULL')
    .all() as unknown as UserRow[];
  const byId = new Map(users.map((u) => [u.id, u]));
  const show = (u: UserRow) => ({
    id: u.id,
    displayName: u.display_name,
    email: u.email,
    phone: u.phone,
    region: u.region && u.country ? `${u.region}, ${u.country}` : null,
    birthDate: u.birth_date,
    joined: new Date(u.created_at).toISOString(),
  });
  const groups: DuplicateGroup[] = [];

  // Prize claims: same legal name + birth date + state.
  const claimed = new Map<string, Set<string>>();
  for (const c of listClaims(db, cfg)) {
    const f = c.form as { legalName?: string; birthDate?: string; address?: { region?: string } } | null;
    if (!f?.legalName || !f.birthDate) continue;
    const key = `${legalNameKey(f.legalName)}|${f.birthDate}|${f.address?.region ?? ''}`;
    if (!claimed.has(key)) claimed.set(key, new Set());
    claimed.get(key)!.add(String(c.user_id));
  }
  for (const [key, ids] of claimed) {
    if (ids.size < 2) continue;
    const [name, dob, region] = key.split('|');
    const players = [...ids].map((id) => byId.get(id)).filter((u): u is UserRow => !!u);
    groups.push({ kind: 'claim', reason: `Prize claims with the same legal name (${name}), birth date ${dob} and state ${region}`, players: players.map(show) });
  }

  // Accounts: same birth date + state, and a similar email or display name.
  const buckets = new Map<string, UserRow[]>();
  for (const u of users) {
    const key = `${u.country}|${u.region}|${u.birth_date}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(u);
  }
  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    // Union players who share an email base or name base (at least 3 letters, so "a1" and "a2" don't match).
    const parent = new Map(list.map((u) => [u.id, u.id]));
    const find = (x: string): string => (parent.get(x) === x ? x : find(parent.get(x)!));
    const join = (a: string, b: string) => parent.set(find(a), find(b));
    const seen = new Map<string, string>();
    for (const u of list) {
      for (const k of [`e:${emailBase(u.email)}`, `n:${nameBase(u.display_name)}`]) {
        if (k.length < 5) continue;
        const other = seen.get(k);
        if (other) join(u.id, other);
        else seen.set(k, u.id);
      }
    }
    const sets = new Map<string, UserRow[]>();
    for (const u of list) {
      const r = find(u.id);
      if (!sets.has(r)) sets.set(r, []);
      sets.get(r)!.push(u);
    }
    for (const set of sets.values()) {
      if (set.length < 2) continue;
      const u = set[0];
      groups.push({
        kind: 'account',
        reason: `Same birth date (${u.birth_date}) and ${u.region}, with a similar email or name`,
        players: set.sort((a, b) => a.created_at - b.created_at).map(show),
      });
    }
  }
  return groups.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'claim' ? -1 : 1));
}

/** Warnings to show on one prize claim on the admin page. */
export function claimFlags(db: DB, claim: { user_id: unknown; form: unknown }, groups: DuplicateGroup[]): string[] {
  const flags: string[] = [];
  const f = claim.form as { birthDate?: string } | null;
  const u = db.prepare('SELECT birth_date FROM users WHERE id = ?').get(String(claim.user_id)) as { birth_date: string | null } | undefined;
  if (f?.birthDate && u?.birth_date && f.birthDate !== u.birth_date) {
    flags.push(`Birth date on the claim (${f.birthDate}) is different from sign-up (${u.birth_date}).`);
  }
  for (const g of groups) {
    const me = g.players.find((p) => p.id === claim.user_id);
    if (!me) continue;
    const others = g.players.filter((p) => p.id !== claim.user_id).map((p) => p.displayName);
    flags.push(`${g.kind === 'claim' ? 'Same person as' : 'Possibly the same person as'} ${others.join(', ')}: ${g.reason.charAt(0).toLowerCase()}${g.reason.slice(1)}.`);
  }
  return flags;
}
