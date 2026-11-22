import { describe, expect, it } from 'vitest';
import * as contract from '@ideanest/plans/catalogue';
import type { Plan } from '@ideanest/plans/catalogue';
import { BILLING_PERIODS, offeredPeriods, priceFor, refusalOf, withPeriods } from './periods';

/*
 * The decimal-free copies must say what the contract says. If `@ideanest/plans` changes one of
 * these rules, this fails until the copy follows — or until the copy is deleted because the
 * package moved the rules somewhere without `decimal.js`.
 */
const BASE: Plan = {
  id: 'p',
  code: 'P',
  name: 'P',
  price: '10.00',
  currency: 'AZN',
  billingPeriod: 'MONTHLY',
  prices: [{ billingPeriod: 'MONTHLY', price: '10.00', currency: 'AZN' }],
  studentOnly: false,
  listed: true,
  sortOrder: 0,
  updatedAt: '',
};
const YEARLY_ONLY: Plan = {
  ...BASE,
  id: 'y',
  billingPeriod: 'YEARLY',
  prices: [{ billingPeriod: 'YEARLY', price: '100.00', currency: 'AZN' }],
};

describe('the decimal-free period rules', () => {
  it('list the periods in the contract’s order', () => {
    expect(BILLING_PERIODS).toEqual(contract.BILLING_PERIODS);
  });

  it('price a period as the contract does', () => {
    for (const plan of [BASE, YEARLY_ONLY]) {
      for (const period of contract.BILLING_PERIODS) {
        expect(priceFor(plan, period)).toEqual(contract.priceFor(plan, period));
      }
    }
  });

  it('offer the periods the contract offers', () => {
    for (const plans of [[], [BASE], [YEARLY_ONLY], [BASE, YEARLY_ONLY]]) {
      expect(offeredPeriods(plans)).toEqual(contract.offeredPeriods(plans));
    }
  });

  it('map every refusal as the contract does', () => {
    const codes = [
      'ALREADY_SUBSCRIBED',
      'PLAN_NOT_ON_SALE',
      'PERIOD_NOT_OFFERED',
      'STUDENT_VERIFICATION_REQUIRED',
      'SOMETHING_ELSE',
      null,
      undefined,
    ];
    for (const status of [400, 401, 403, 409, 500, null]) {
      for (const code of codes) expect(refusalOf(status, code)).toBe(contract.refusalOf(status, code));
    }
  });
});

describe('withPeriods', () => {
  it('reads a plan from a service that predates the periods as the contract’s reader does', () => {
    const old = { ...BASE, prices: undefined, studentOnly: undefined } as unknown as Plan;
    const read = contract.readPlan({ ...old });
    expect(withPeriods(old).prices).toEqual(read?.prices);
    expect(withPeriods(old).studentOnly).toBe(false);
  });

  it('keeps the periods a plan has', () => {
    expect(withPeriods(YEARLY_ONLY)).toEqual(YEARLY_ONLY);
  });
});
