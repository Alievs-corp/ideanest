import { describe, expect, it } from 'vitest';
import { cardReturnFor, cardReturnHint } from './payout';

describe('cardReturnFor', () => {
  it('returns to the payout page, in the language it was read in', () => {
    expect(cardReturnFor({ origin: 'https://ideanest.az', pathname: '/tr/settings/payout' })).toEqual({
      language: 'tr',
      successUrl: 'https://ideanest.az/tr/settings/payout?card=returned',
      errorUrl: 'https://ideanest.az/tr/settings/payout?card=failed',
    });
  });
});

describe('cardReturnHint', () => {
  it('reads the two words the return addresses carry, and nothing else', () => {
    expect(cardReturnHint('?card=returned')).toBe('returned');
    expect(cardReturnHint('?card=failed')).toBe('failed');
    expect(cardReturnHint('?card=verified')).toBeNull();
  });
});
