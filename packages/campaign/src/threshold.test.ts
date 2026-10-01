import { describe, expect, it } from 'vitest';
import { successThresholdOf } from './threshold';

describe('successThresholdOf', () => {
  it('is 80% of the goal, in the goal’s currency', () => {
    expect(successThresholdOf({ amount: '10000.00', currency: 'AZN' })).toEqual({
      amount: '8000.00',
      currency: 'AZN',
    });
  });

  it('rounds up to the cent, so the amount named is enough to succeed', () => {
    expect(successThresholdOf({ amount: '10.01', currency: 'AZN' }).amount).toBe('8.01');
    expect(successThresholdOf({ amount: '0.01', currency: 'AZN' }).amount).toBe('0.01');
  });

  /**
   * #155. 1001.01 × 0.80 is 800.808, and ROUND_UP names 800.81: a cent less would be an amount
   * the campaign could raise and still fail.
   */
  it('rounds 800.808 up to 800.81', () => {
    expect(successThresholdOf({ amount: '1001.01', currency: 'AZN' }).amount).toBe('800.81');
  });

  /**
   * No float on the way. 1.10 × 0.8 is exactly 0.88, but `1.1 * 0.8` in IEEE 754 is
   * 0.8800000000000001, which any rounding up to the cent turns into 0.89. A threshold computed
   * through a number would name a cent more than the campaign needs.
   */
  it('has no floating-point path', () => {
    expect(1.1 * 0.8).not.toBe(0.88);
    expect(successThresholdOf({ amount: '1.10', currency: 'AZN' }).amount).toBe('0.88');
    expect(successThresholdOf({ amount: '123456789012.34', currency: 'AZN' }).amount).toBe(
      '98765431209.88',
    );
  });
});
