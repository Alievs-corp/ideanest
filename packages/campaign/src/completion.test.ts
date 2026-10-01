import { describe, expect, it } from 'vitest';
import { completionOf } from './completion';

/**
 * The funded percent both clients draw beside the progress bar (#155). Rounded down, because
 * 100% is the word "funded"; `null` rather than infinity or a throw where there is nothing to
 * be a share of.
 */
describe('completionOf', () => {
  const goal = { amount: '10000.00', currency: 'AZN' };

  it('rounds down rather than to nearest', () => {
    expect(completionOf({ amount: '9999.60', currency: 'AZN' }, goal)?.toFixed(2)).toBe('99.99');
  });

  it('goes past 100 when a campaign is overfunded', () => {
    expect(completionOf({ amount: '12500.00', currency: 'AZN' }, goal)?.toFixed(2)).toBe('125.00');
  });

  it('is computed from the strings, so a thousand cents are exactly ten manat of a hundred', () => {
    expect(completionOf({ amount: '10.00', currency: 'AZN' }, { amount: '100.00', currency: 'AZN' })?.toFixed(2)).toBe(
      '10.00',
    );
  });

  it('is null with no goal, a zero goal or a malformed amount', () => {
    expect(completionOf({ amount: '1.00', currency: 'AZN' }, null)).toBeNull();
    expect(completionOf({ amount: '1.00', currency: 'AZN' }, { amount: '0.00', currency: 'AZN' })).toBeNull();
    expect(completionOf({ amount: 'lots', currency: 'AZN' }, goal)).toBeNull();
  });
});
