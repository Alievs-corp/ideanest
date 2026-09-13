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
});
