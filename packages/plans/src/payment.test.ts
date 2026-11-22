import { describe, expect, it } from 'vitest';
import type { HeldSubscription } from './catalogue';
import {
  planPaymentDepartureOf,
  planPaymentRefusalOf,
  planPaymentReturnOf,
  readPlanPaymentDeparture,
  renewalStandingOf,
} from './payment';

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
    prices: [{ billingPeriod: 'MONTHLY' as const, price: '19.00', currency: 'AZN' }],
    studentOnly: false,
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
  renewalPrices: [],
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

  it('says a student plan refused for want of an approved student card as that (#655)', () => {
    // A renewal or first payment of a student plan whose approval lapsed or was revoked: the reader
    // sends their card again, which is a different instruction from "try again later".
    expect(planPaymentRefusalOf(403, 'STUDENT_VERIFICATION_REQUIRED', undefined)).toBe('studentVerificationRequired');
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

describe('a refused extension', () => {
  it('names a period the plan is not sold for', () => {
    expect(planPaymentRefusalOf(400, 'PERIOD_NOT_OFFERED', undefined)).toBe('periodNotOffered');
  });
});

describe('coming back from paying, with a month-long renewal window (#660)', () => {
  const pending = {
    ...subscription,
    state: 'PENDING_PAYMENT' as const,
    entitled: false,
    currentPeriodEnd: null,
    paymentDue: 'FIRST_PERIOD' as const,
  };
  // A monthly plan has a renewal due from the moment its first period is paid.
  const firstPaid = { ...subscription, paymentDue: 'RENEWAL' as const };
  const extended = { ...firstPaid, currentPeriodEnd: '2026-11-01T00:00:00Z' };

  it('calls a first monthly payment paid although a renewal is due straight after it', () => {
    const left = planPaymentDepartureOf(pending);
    expect(planPaymentReturnOf('returned', pending, false, left)).toBe('waiting');
    expect(planPaymentReturnOf('returned', firstPaid, false, left)).toBe('paid');
    expect(planPaymentReturnOf('failed', firstPaid, false, left)).toBe('paid');
  });

  it('calls an extension paid once the end has moved, and not before', () => {
    const left = planPaymentDepartureOf(firstPaid);
    expect(planPaymentReturnOf('returned', firstPaid, false, left)).toBe('waiting');
    expect(planPaymentReturnOf('returned', firstPaid, true, left)).toBe('unconfirmed');
    expect(planPaymentReturnOf('failed', firstPaid, false, left)).toBe('failed');
    expect(planPaymentReturnOf('returned', extended, false, left)).toBe('paid');
  });

  it('does not call an unchanged plan paid because nothing is due', () => {
    const left = planPaymentDepartureOf(firstPaid);
    expect(planPaymentReturnOf('returned', { ...firstPaid, paymentDue: null }, false, left)).toBe('waiting');
  });

  it('ignores a departure remembered for another subscription, falling back to the older rule', () => {
    const left = { ...planPaymentDepartureOf(pending), subscriptionId: 'someone-else' };
    expect(planPaymentReturnOf('returned', firstPaid, false, left)).toBe('waiting');
    expect(planPaymentReturnOf('returned', subscription, false, left)).toBe('paid');
  });

  it('says nothing about a plan that lapsed meanwhile', () => {
    const left = planPaymentDepartureOf(firstPaid);
    expect(planPaymentReturnOf('returned', { ...firstPaid, entitled: false, paymentDue: null }, false, left)).toBeNull();
  });

  it('reads a remembered departure back, and nothing else', () => {
    const left = planPaymentDepartureOf(firstPaid);
    expect(readPlanPaymentDeparture(JSON.parse(JSON.stringify(left)))).toEqual(left);
    expect(readPlanPaymentDeparture({ ...left, currentPeriodEnd: null })).toEqual({ ...left, currentPeriodEnd: null });
    expect(readPlanPaymentDeparture(null)).toBeNull();
    expect(readPlanPaymentDeparture('paid')).toBeNull();
    expect(readPlanPaymentDeparture({ state: 'ACTIVE', currentPeriodEnd: null })).toBeNull();
    expect(readPlanPaymentDeparture({ ...left, currentPeriodEnd: 7 })).toBeNull();
  });
});

describe('a renewal that is due, early or urgent (#660)', () => {
  const now = Date.parse('2026-09-10T00:00:00Z');
  const due = { ...subscription, paymentDue: 'RENEWAL' as const };

  it('is an option while more than seven days are left, and a warning from then on', () => {
    expect(renewalStandingOf(due, now)).toBe('early');
    expect(renewalStandingOf({ ...due, currentPeriodEnd: '2026-09-17T00:00:01Z' }, now)).toBe('early');
    expect(renewalStandingOf({ ...due, currentPeriodEnd: '2026-09-17T00:00:00Z' }, now)).toBe('urgent');
    expect(renewalStandingOf({ ...due, currentPeriodEnd: '2026-09-12T00:00:00Z' }, now)).toBe('urgent');
    expect(renewalStandingOf({ ...due, currentPeriodEnd: null }, now)).toBe('urgent');
  });

  it('is nothing when no renewal is due or the plan no longer entitles', () => {
    expect(renewalStandingOf(subscription, now)).toBe('none');
    expect(renewalStandingOf({ ...due, entitled: false }, now)).toBe('none');
  });
});
