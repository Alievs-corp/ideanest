import { describe, expect, it } from 'vitest';
import { readPlan, type Plan } from '@ideanest/plans/catalogue';
import { withPeriods } from './with-periods';

const BASE: Plan = {
  id: 'p',
  code: 'P',
  name: 'P',
  price: '10.00',
  currency: 'AZN',
  billingPeriod: 'MONTHLY',
  prices: [{ billingPeriod: 'YEARLY', price: '100.00', currency: 'AZN' }],
  studentOnly: true,
  listed: true,
  sortOrder: 0,
  updatedAt: '',
};

describe('withPeriods', () => {
  it('reads a plan from a service that predates the periods as the contract’s reader does', () => {
    const old = { ...BASE, prices: undefined, studentOnly: undefined } as unknown as Plan;
    expect(withPeriods(old).prices).toEqual(readPlan({ ...old })?.prices);
    expect(withPeriods(old).studentOnly).toBe(false);
  });

  it('keeps the periods a plan has', () => {
    expect(withPeriods(BASE)).toEqual(BASE);
  });
});
