import { describe, expect, it } from 'vitest';
import { amountAt, formatAmountAt } from './money';

describe('the count-up amount', () => {
  it('starts at zero and ends exactly on the target', () => {
    expect(amountAt('12650.00', 0)).toBe('0.00');
    expect(amountAt('12650.00', 1)).toBe('12650.00');
  });

  it('is computed in decimal, so a fraction of the target has no float residue', () => {
    expect(amountAt('0.30', 1)).toBe('0.30');
    expect(amountAt('12650.00', 0.5)).toBe('6325.00');
    expect(amountAt('999999999999.99', 1)).toBe('999999999999.99');
  });

  it('never overshoots the target or goes below zero', () => {
    expect(amountAt('12650.00', 1.2)).toBe('12650.00');
    expect(amountAt('12650.00', -0.1)).toBe('0.00');
  });

  it('only ever counts up', () => {
    let previous = '0.00';
    for (let i = 0; i <= 48; i++) {
      const next = amountAt('12650.00', i / 48);
      expect(Number(next)).toBeGreaterThanOrEqual(Number(previous));
      previous = next;
    }
  });

  it('prints the amount the way the app does', () => {
    expect(formatAmountAt('12650.00', 'AZN', 1)).toBe('12,650.00 AZN');
    expect(formatAmountAt('12650.00', 'AZN', 0)).toBe('0.00 AZN');
  });
});
