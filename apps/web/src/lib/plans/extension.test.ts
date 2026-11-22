import { describe, expect, it } from 'vitest';
import type { HeldSubscription } from './api';
import { extendedEnd, extensionChoices, extensionShown } from './extension';

const HELD: HeldSubscription = {
  id: '22222222-0000-4000-8000-000000000001',
  state: 'ACTIVE',
  entitled: true,
  plan: {
    id: '11111111-0000-4000-8000-000000000001',
    code: 'STARTER',
    name: 'Starter',
    description: null,
    price: '19.00',
    currency: 'AZN',
    billingPeriod: 'MONTHLY',
    prices: [{ billingPeriod: 'MONTHLY', price: '19.00', currency: 'AZN' }],
    studentOnly: false,
    maxActiveCampaigns: 1,
    goalCeiling: null,
    listed: true,
    sortOrder: 10,
    updatedAt: '2026-08-01T09:00:00Z',
  },
  price: '19.00',
  currency: 'AZN',
  billingPeriod: 'SEMIANNUAL',
  startedAt: '2026-03-01T09:00:00Z',
  currentPeriodEnd: '2026-09-01T09:00:00Z',
  cancelAtPeriodEnd: false,
  createdAt: '2026-03-01T09:00:00Z',
  paymentDue: 'RENEWAL',
  renewalOpensAt: '2026-08-01T09:00:00Z',
  renewalPrices: [
    { billingPeriod: 'YEARLY', price: '190.00', currency: 'AZN' },
    { billingPeriod: 'MONTHLY', price: '19.00', currency: 'AZN' },
    { billingPeriod: 'SEMIANNUAL', price: '99.00', currency: 'AZN' },
  ],
};

describe('the periods a subscription can be extended by (#660)', () => {
  it('lists them shortest first', () => {
    expect(extensionChoices(HELD).map((choice) => choice.billingPeriod)).toEqual(['MONTHLY', 'SEMIANNUAL', 'YEARLY']);
  });

  it('offers nothing outside the renewal window, for a lapsed plan, or from a service with no list', () => {
    expect(extensionChoices({ ...HELD, paymentDue: null })).toEqual([]);
    expect(extensionChoices({ ...HELD, entitled: false })).toEqual([]);
    expect(extensionChoices({ ...HELD, paymentDue: 'FIRST_PERIOD' })).toEqual([]);
    const { renewalPrices: _omit, ...older } = HELD;
    expect(extensionChoices(older)).toEqual([]);
  });

  it('drops an entry it cannot read and fills a missing currency from the subscription', () => {
    const odd = [
      { billingPeriod: 'WEEKLY', price: '1.00', currency: 'AZN' },
      { billingPeriod: 'YEARLY', price: '', currency: 'AZN' },
      { billingPeriod: 'MONTHLY', price: '19.00' },
    ] as unknown as HeldSubscription['renewalPrices'];
    expect(extensionChoices({ ...HELD, renewalPrices: odd })).toEqual([
      { billingPeriod: 'MONTHLY', price: '19.00', currency: 'AZN' },
    ]);
  });

  it('selects the reader’s pick, else the period held, else the shortest', () => {
    const choices = extensionChoices(HELD);
    expect(extensionShown(choices, 'YEARLY', 'SEMIANNUAL')?.billingPeriod).toBe('YEARLY');
    expect(extensionShown(choices, null, 'SEMIANNUAL')?.billingPeriod).toBe('SEMIANNUAL');
    const noHeld = choices.filter((choice) => choice.billingPeriod !== 'SEMIANNUAL');
    expect(extensionShown(noHeld, 'SEMIANNUAL', 'SEMIANNUAL')?.billingPeriod).toBe('MONTHLY');
    expect(extensionShown([], null, 'SEMIANNUAL')).toBeNull();
  });
});

describe('where an extension leaves the plan (#660)', () => {
  it('adds calendar months to the current end, in UTC', () => {
    expect(extendedEnd('2026-09-01T09:00:00Z', 'MONTHLY')).toBe('2026-10-01T09:00:00.000Z');
    expect(extendedEnd('2026-09-01T09:00:00Z', 'SEMIANNUAL')).toBe('2027-03-01T09:00:00.000Z');
    expect(extendedEnd('2026-09-01T09:00:00Z', 'YEARLY')).toBe('2027-09-01T09:00:00.000Z');
    expect(extendedEnd('2026-11-15T23:30:00Z', 'MONTHLY')).toBe('2026-12-15T23:30:00.000Z');
    expect(extendedEnd('2026-12-10T00:00:00Z', 'MONTHLY')).toBe('2027-01-10T00:00:00.000Z');
  });

  it('clamps to the last day of a shorter month, as java.time does', () => {
    expect(extendedEnd('2027-01-31T12:00:00Z', 'MONTHLY')).toBe('2027-02-28T12:00:00.000Z');
    expect(extendedEnd('2027-08-31T12:00:00Z', 'SEMIANNUAL')).toBe('2028-02-29T12:00:00.000Z');
    expect(extendedEnd('2028-02-29T12:00:00Z', 'YEARLY')).toBe('2029-02-28T12:00:00.000Z');
  });

  it('has no answer for an end that is missing or not a date', () => {
    expect(extendedEnd(null, 'MONTHLY')).toBeNull();
    expect(extendedEnd(undefined, 'MONTHLY')).toBeNull();
    expect(extendedEnd('not a date', 'MONTHLY')).toBeNull();
  });
});
