import { describe, expect, it } from 'vitest';
import { paymentReturnFor, paymentReturnHint } from './payment';

describe('paymentReturnFor', () => {
  it('returns to the pledge page, in the language the checkout was read in', () => {
    expect(
      paymentReturnFor('pledge-1', { origin: 'https://ideanest.az', pathname: '/ru/projects/p-1/back' }),
    ).toEqual({
      language: 'ru',
      successUrl: 'https://ideanest.az/ru/pledges/pledge-1?payment=returned',
      errorUrl: 'https://ideanest.az/ru/pledges/pledge-1?payment=failed',
    });
  });

  it('falls back to the default language for a path that names none', () => {
    expect(paymentReturnFor('p', { origin: 'https://ideanest.az', pathname: '/' }).language).toBe('en');
  });
});

describe('paymentReturnHint', () => {
  it('reads the two words the return URLs carry, and nothing else', () => {
    expect(paymentReturnHint('?payment=returned')).toBe('returned');
    expect(paymentReturnHint('?payment=failed')).toBe('failed');
    expect(paymentReturnHint('?payment=paid')).toBeNull();
    expect(paymentReturnHint('')).toBeNull();
  });
});
