import { describe, expect, it } from 'vitest';
import { gradePick } from '../src/grading.ts';
import { payoutMultiplier, winPayout } from '../src/points.ts';

describe('gradePick', () => {
  it('grades moneyline', () => {
    expect(gradePick({ market: 'moneyline', selection: 'home', point: null }, 24, 21)).toBe('won');
    expect(gradePick({ market: 'moneyline', selection: 'away', point: null }, 24, 21)).toBe('lost');
    expect(gradePick({ market: 'moneyline', selection: 'away', point: null }, 3, 3)).toBe('push');
  });

  it('grades spreads', () => {
    expect(gradePick({ market: 'spread', selection: 'home', point: -3.5 }, 24, 21)).toBe('lost');
    expect(gradePick({ market: 'spread', selection: 'away', point: 3.5 }, 24, 21)).toBe('won');
    expect(gradePick({ market: 'spread', selection: 'home', point: -3 }, 24, 21)).toBe('push');
    expect(gradePick({ market: 'spread', selection: 'home', point: -2.5 }, 24, 21)).toBe('won');
  });

  it('grades totals', () => {
    expect(gradePick({ market: 'total', selection: 'over', point: 44.5 }, 24, 21)).toBe('won');
    expect(gradePick({ market: 'total', selection: 'under', point: 44.5 }, 24, 21)).toBe('lost');
    expect(gradePick({ market: 'total', selection: 'under', point: 45 }, 24, 21)).toBe('push');
  });
});

describe('payouts', () => {
  it('converts prices to multipliers', () => {
    expect(payoutMultiplier(150)).toBe(2.5);
    expect(payoutMultiplier(-200)).toBe(1.5);
    expect(winPayout(100, -110)).toBe(190);
    expect(winPayout(10, 130)).toBe(23);
  });
});
