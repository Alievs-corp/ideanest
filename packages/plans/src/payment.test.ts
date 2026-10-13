import { describe, expect, it } from 'vitest';
import type { HeldSubscription } from './catalogue';
import { planPaymentRefusalOf, planPaymentReturnOf } from './payment';

const subscription: HeldSubscription = {
  id: 'f0c3a7e2-1d4b-4c55-8b0e-3c1d2e3f4a5b',
  state: 'ACTIVE',
  entitled: true,
  plan: {
    id: '6b1f8a8e-2c1a-4a7e-9a55-0d3c1a9b7e10',
    code: 'GROWTH',
    name: 'Growth',
    price: '19.00',
    currency: 'AZN',
    billingPeriod: 'MONTHLY',
    listed: true,
    sortOrder: 2,
    updatedAt: '2026-09-01T00:00:00Z',
  },
  price: '19.00',
  currency: 'AZN',
  billingPeriod: 'MONTHLY',
  startedAt: '2026-09-01T00:00:00Z',
  currentPeriodEnd: '2026-10-01T00:00:00Z',
  cancelAtPeriodEnd: false,
  createdAt: '2026-09-01T00:00:00Z',
  paymentDue: null,
  renewalOpensAt: '2026-09-24T00:00:00Z',
};

describe('paying for a plan', () => {
  it('maps a refused plan payment by its code and reason', () => {
    expect(planPaymentRefusalOf(409, 'SUBSCRIPTION_PAYMENT_NOT_DUE', 'FREE_PLAN')).toBe('freePlan');
    expect(planPaymentRefusalOf(409, 'SUBSCRIPTION_PAYMENT_NOT_DUE', 'RENEWAL_NOT_OPEN')).toBe('renewalNotOpen');
    expect(planPaymentRefusalOf(409, 'SUBSCRIPTION_PAYMENT_NOT_DUE', 'LAPSED')).toBe('lapsed');
    expect(planPaymentRefusalOf(409, 'SUBSCRIPTION_PAYMENT_NOT_DUE', undefined)).toBe('notDue');
    expect(planPaymentRefusalOf(503, 'PAYMENT_UNAVAILABLE', undefined)).toBe('paymentUnavailable');
    expect(planPaymentRefusalOf(503, null, undefined)).toBe('paymentUnavailable');
    expect(planPaymentRefusalOf(401, null, undefined)).toBe('signedOut');
    expect(planPaymentRefusalOf(404, null, undefined)).toBe('generic');
  });

  it('decides what a return from the payment page means from the subscription, not the address', () => {
    const pending = { ...subscription, state: 'PENDING_PAYMENT' as const, entitled: false, paymentDue: 'FIRST_PERIOD' as const };
    const renewing = { ...subscription, paymentDue: 'RENEWAL' as const };

    expect(planPaymentReturnOf('returned', pending, false)).toBe('waiting');
    expect(planPaymentReturnOf('returned', pending, true)).toBe('unconfirmed');
    expect(planPaymentReturnOf('failed', pending, false)).toBe('failed');
    expect(planPaymentReturnOf('returned', renewing, false)).toBe('waiting');

    // Paid is paid whichever door they came through: the callback is the fact, the word a hint.
    expect(planPaymentReturnOf('returned', subscription, false)).toBe('paid');
    expect(planPaymentReturnOf('failed', subscription, false)).toBe('paid');

    expect(planPaymentReturnOf('returned', null, false)).toBeNull();
    expect(planPaymentReturnOf('returned', { ...subscription, entitled: false }, true)).toBeNull();
  });
});
