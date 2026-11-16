import { describe, expect, it } from 'vitest';
import { billingPeriod, periodFromKey, periodWindow, sportsDay } from '../src/time.ts';
import { et } from './helpers.ts';

const TZ = 'America/New_York';

describe('time helpers', () => {
  it('puts a 1 AM game in the previous sports day', () => {
    const d = sportsDay(et(2026, 11, 22, 1), TZ, 5);
    expect(d.key).toBe('2026-11-21');
    expect(d.start).toBe(et(2026, 11, 21, 5));
    expect(d.end).toBe(et(2026, 11, 22, 5));
  });

  it('handles the DST change (Nov 1 2026 is 25 hours long)', () => {
    const d = sportsDay(et(2026, 11, 1, 12), TZ, 5);
    expect(d.end - d.start).toBe(24 * 3600_000);
    const day = sportsDay(et(2026, 10, 31, 12), TZ, 5);
    expect(day.end - day.start).toBe(25 * 3600_000);
  });

  it('computes weekly periods Monday to Monday', () => {
    const w = periodWindow('weekly', et(2026, 11, 21, 15), TZ); // Saturday
    expect(w.key).toBe('weekly:2026-11-16');
    expect(w.start).toBe(et(2026, 11, 16, 0));
    expect(w.end).toBe(et(2026, 11, 23, 0));
  });

  it('computes monthly periods and round-trips keys', () => {
    const m = periodWindow('monthly', et(2026, 12, 31, 23), TZ);
    expect(m.key).toBe('monthly:2026-12');
    expect(m.end).toBe(et(2027, 1, 1, 0));
    expect(periodFromKey('monthly:2026-12', TZ).start).toBe(m.start);
    expect(periodFromKey('weekly:2026-11-16', TZ).end).toBe(et(2026, 11, 23, 0));
    expect(() => periodFromKey('weekly:2026-11-17', TZ)).toThrow();
  });

  it('computes the billing period from the reset day', () => {
    const p = billingPeriod(Date.UTC(2026, 10, 3), 5);
    expect(p.start).toBe(Date.UTC(2026, 9, 5));
    expect(p.end).toBe(Date.UTC(2026, 10, 5));
  });
});
