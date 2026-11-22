import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as catalogue from './catalogue';
import {
  BILLING_PERIODS,
  MONTHS_IN,
  isBillingPeriod,
  canonicalAmount,
  isZeroAmount,
  offeredPeriods,
  priceFor,
  refusalOf,
  sameAmount,
} from './periods';
import Decimal from 'decimal.js';

describe('the period module', () => {
  it('imports nothing, so a page can use it without decimal.js (#655)', () => {
    const source = readFileSync(fileURLToPath(new URL('./periods.ts', import.meta.url)), 'utf8');
    expect(source).not.toMatch(/^import /m);
  });

  it('is what ./catalogue re-exports, so callers of either read the same rules', () => {
    expect(catalogue.priceFor).toBe(priceFor);
    expect(catalogue.offeredPeriods).toBe(offeredPeriods);
    expect(catalogue.refusalOf).toBe(refusalOf);
    expect(catalogue.BILLING_PERIODS).toBe(BILLING_PERIODS);
    expect(catalogue.MONTHS_IN).toBe(MONTHS_IN);
  });

  it('lists the periods shortest first and knows their length', () => {
    expect(BILLING_PERIODS).toEqual(['MONTHLY', 'SEMIANNUAL', 'YEARLY']);
    expect(MONTHS_IN.SEMIANNUAL).toBe(6);
    expect(isBillingPeriod('SEMIANNUAL')).toBe(true);
    expect(isBillingPeriod('WEEKLY')).toBe(false);
  });

  it('offers only the periods some plan is sold for', () => {
    const monthly = { prices: [{ billingPeriod: 'MONTHLY' as const, price: '10.00', currency: 'AZN' }] };
    const yearly = { prices: [{ billingPeriod: 'YEARLY' as const, price: '100.00', currency: 'AZN' }] };
    expect(offeredPeriods([monthly, yearly])).toEqual(['MONTHLY', 'YEARLY']);
    expect(priceFor(monthly, 'YEARLY')).toBeNull();
  });

  it('reads zero without decimal.js, as catalogue.isFreePrice does', () => {
    for (const amount of ['0', '0.00', '00.0', '-0', '19.00', '0.01', '10', 'abc', '', '.']) {
      expect(isZeroAmount(amount), amount).toBe(catalogue.isFreePrice(amount));
    }
  });

  it('maps every choice refusal by its code', () => {
    expect(refusalOf(400, 'PERIOD_NOT_OFFERED')).toBe('periodNotOffered');
    expect(refusalOf(403, 'STUDENT_VERIFICATION_REQUIRED')).toBe('studentVerificationRequired');
    expect(refusalOf(401, null)).toBe('signedOut');
  });

  it('compares amounts as decimals do, without decimal.js', () => {
    const amounts = ['60', '60.00', '060.0', '60.5', '60.50', '0', '0.00', '-0', '19.99', '19.990', '1000', '100.0'];
    for (const left of amounts) {
      for (const right of amounts) {
        expect(sameAmount(left, right), `${left} vs ${right}`).toBe(new Decimal(left).equals(right));
      }
    }
    expect(canonicalAmount('60.00')).toBe('60');
    expect(canonicalAmount('abc')).toBeNull();
    expect(sameAmount('abc', 'abc')).toBe(false);
  });
});
