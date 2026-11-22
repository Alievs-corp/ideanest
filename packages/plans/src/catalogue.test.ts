import { describe, expect, it } from 'vitest';
import {
  canChoose,
  isFreePrice,
  isHeldPlan,
  offeredPeriods,
  priceFor,
  readMine,
  readPlan,
  readPlanCatalogue,
  refusalOf,
  standingOf,
  type HeldSubscription,
} from './catalogue';

const growth = {
  id: '6b1f8a8e-2c1a-4a7e-9a55-0d3c1a9b7e10',
  code: 'GROWTH',
  name: 'Growth',
  description: 'For a second campaign',
  price: '19.00',
  currency: 'AZN',
  billingPeriod: 'MONTHLY',
  prices: [{ billingPeriod: 'MONTHLY' as const, price: '19.00', currency: 'AZN' }],
  studentOnly: false,
  maxActiveCampaigns: 3,
  goalCeiling: '50000.00',
  listed: true,
  sortOrder: 2,
  updatedAt: '2026-09-01T00:00:00Z',
};

const held = {
  id: 'f0c3a7e2-1d4b-4c55-8b0e-3c1d2e3f4a5b',
  state: 'ACTIVE',
  entitled: true,
  plan: growth,
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

describe('reading the plan catalogue', () => {
  it('reads a plan and keeps every amount a string', () => {
    const plan = readPlan(growth);
    expect(plan).toEqual(growth);
    expect(typeof plan?.price).toBe('string');
    expect(typeof plan?.goalCeiling).toBe('string');
  });

  it('keeps "no limit" as null, never as zero', () => {
    const plan = readPlan({ ...growth, maxActiveCampaigns: null, goalCeiling: undefined });
    expect(plan?.maxActiveCampaigns).toBeNull();
    expect(plan?.goalCeiling).toBeNull();
  });

  it('refuses a limit that is present and unreadable, rather than printing "no limit"', () => {
    expect(readPlan({ ...growth, maxActiveCampaigns: -1 })).toBeNull();
    expect(readPlan({ ...growth, maxActiveCampaigns: 2.5 })).toBeNull();
    expect(readPlan({ ...growth, maxActiveCampaigns: '3' })).toBeNull();
    expect(readPlan({ ...growth, goalCeiling: 'lots' })).toBeNull();
    expect(readPlan({ ...growth, goalCeiling: 50000 })).toBeNull();
  });

  it('refuses a plan without a decimal price, an id, a name or a known period', () => {
    expect(readPlan({ ...growth, price: 19 })).toBeNull();
    expect(readPlan({ ...growth, price: 'nineteen' })).toBeNull();
    expect(readPlan({ ...growth, id: '' })).toBeNull();
    expect(readPlan({ ...growth, name: undefined })).toBeNull();
    expect(readPlan({ ...growth, billingPeriod: 'WEEKLY' })).toBeNull();
  });

  it('drops a malformed entry and keeps the rest, in order', () => {
    const starter = { ...growth, id: 'starter', name: 'Starter', price: '0.00' };
    expect(readPlanCatalogue({ plans: [starter, { name: 'broken' }, growth] })?.map((plan) => plan.name)).toEqual([
      'Starter',
      'Growth',
    ]);
  });

  it('tells an empty catalogue apart from a body that is not one', () => {
    expect(readPlanCatalogue({ plans: [] })).toEqual([]);
    expect(readPlanCatalogue({})).toBeNull();
    expect(readPlanCatalogue(null)).toBeNull();
    expect(readPlanCatalogue([growth])).toBeNull();
  });
});

describe('reading what an account holds', () => {
  it('reads nothing held as null, whether the key is null or absent', () => {
    expect(readMine({ subscription: null })).toEqual({ subscription: null });
    expect(readMine({})).toEqual({ subscription: null });
  });

  it('reads a held subscription', () => {
    expect(readMine({ subscription: held })?.subscription).toEqual(held);
  });

  it('reads what is due to be paid, and anything it does not know as nothing due', () => {
    expect(readMine({ subscription: { ...held, paymentDue: 'RENEWAL' } })?.subscription?.paymentDue).toBe('RENEWAL');
    expect(readMine({ subscription: { ...held, paymentDue: 'FIRST_PERIOD' } })?.subscription?.paymentDue).toBe(
      'FIRST_PERIOD',
    );
    // A guess would offer to take money for the wrong thing; a missing button costs less.
    expect(readMine({ subscription: { ...held, paymentDue: 'SOMETHING' } })?.subscription?.paymentDue).toBeNull();
    const older = { ...held } as Record<string, unknown>;
    delete older.paymentDue;
    delete older.renewalOpensAt;
    expect(readMine({ subscription: older })?.subscription).toMatchObject({ paymentDue: null, renewalOpensAt: null });
  });

  it('refuses a subscription it cannot render a decision from, rather than reading it as none', () => {
    expect(readMine({ subscription: { ...held, entitled: 'yes' } })).toBeNull();
    expect(readMine({ subscription: { ...held, state: 'PAUSED' } })).toBeNull();
    expect(readMine({ subscription: { ...held, plan: null } })).toBeNull();
    expect(readMine({ subscription: 'held' })).toBeNull();
    expect(readMine('nothing')).toBeNull();
  });
});

describe('the rules the page draws by', () => {
  const subscription = readMine({ subscription: held })?.subscription as HeldSubscription;

  it('tests a free price with decimal.js', () => {
    expect(isFreePrice('0.00')).toBe(true);
    expect(isFreePrice('0')).toBe(true);
    expect(isFreePrice('19.00')).toBe(false);
    expect(isFreePrice('0.01')).toBe(false);
    expect(isFreePrice('not a number')).toBe(false);
  });

  it('says where a holder stands in each of the four states', () => {
    expect(standingOf({ ...subscription, state: 'PENDING_PAYMENT', entitled: false })).toBe('pending');
    expect(standingOf(subscription)).toBe('active');
    expect(standingOf({ ...subscription, cancelAtPeriodEnd: true })).toBe('ending');
    expect(standingOf({ ...subscription, state: 'EXPIRED', entitled: false })).toBe('lapsed');
    // `entitled` decides, not `state`: an ACTIVE subscription whose period ended entitles nobody.
    expect(standingOf({ ...subscription, entitled: false })).toBe('lapsed');
  });

  it('offers a choice unless an entitling plan is held, or it is the unpaid plan itself', () => {
    expect(canChoose(null, growth.id)).toBe(true);
    expect(canChoose(subscription, 'starter')).toBe(false);
    expect(canChoose({ ...subscription, cancelAtPeriodEnd: true }, 'starter')).toBe(false);
    expect(canChoose({ ...subscription, state: 'PENDING_PAYMENT', entitled: false }, 'starter')).toBe(true);
    expect(canChoose({ ...subscription, state: 'PENDING_PAYMENT', entitled: false }, growth.id)).toBe(false);
    expect(canChoose({ ...subscription, entitled: false }, growth.id)).toBe(true);
    expect(canChoose({ ...subscription, state: 'CANCELED' }, growth.id)).toBe(true);
  });

  it('marks the held plan, unless it was cancelled', () => {
    expect(isHeldPlan(subscription, growth.id)).toBe(true);
    expect(isHeldPlan(subscription, 'starter')).toBe(false);
    expect(isHeldPlan({ ...subscription, state: 'CANCELED' }, growth.id)).toBe(false);
    expect(isHeldPlan(null, growth.id)).toBe(false);
  });

  it('maps a refusal by its code and status, never its prose', () => {
    expect(refusalOf(409, 'ALREADY_SUBSCRIBED')).toBe('alreadySubscribed');
    expect(refusalOf(409, 'PLAN_NOT_ON_SALE')).toBe('notOnSale');
    expect(refusalOf(401, null)).toBe('signedOut');
    expect(refusalOf(500, 'SOMETHING')).toBe('generic');
    expect(refusalOf(null, undefined)).toBe('generic');
  });
});

describe('plan prices by period', () => {
  it('reads every offered period, shortest first, and drops unreadable entries', () => {
    const plan = readPlan({
      ...growth,
      studentOnly: true,
      prices: [
        { billingPeriod: 'YEARLY', price: '190.00', currency: 'AZN' },
        { billingPeriod: 'MONTHLY', price: '19.00', currency: 'AZN' },
        { billingPeriod: 'SEMIANNUAL', price: 'nope', currency: 'AZN' },
        { billingPeriod: 'WEEKLY', price: '5.00', currency: 'AZN' },
      ],
    });
    expect(plan?.studentOnly).toBe(true);
    expect(plan?.prices.map((p) => p.billingPeriod)).toEqual(['MONTHLY', 'YEARLY']);
    expect(plan && priceFor(plan, 'YEARLY')?.price).toBe('190.00');
    expect(plan && priceFor(plan, 'SEMIANNUAL')).toBeNull();
  });

  it('falls back to the plan price when the body has no prices', () => {
    const plan = readPlan(growth);
    expect(plan?.studentOnly).toBe(false);
    expect(plan?.prices).toEqual([{ billingPeriod: 'MONTHLY', price: '19.00', currency: 'AZN' }]);
  });

  it('reads a six-month plan', () => {
    expect(readPlan({ ...growth, billingPeriod: 'SEMIANNUAL' })?.billingPeriod).toBe('SEMIANNUAL');
  });

  it('offers only the periods some plan is sold for', () => {
    const monthly = readPlan(growth);
    const both = readPlan({
      ...growth,
      id: 'other',
      prices: [
        { billingPeriod: 'MONTHLY', price: '10.00', currency: 'AZN' },
        { billingPeriod: 'SEMIANNUAL', price: '60.00', currency: 'AZN' },
      ],
    });
    expect(monthly && both && offeredPeriods([monthly, both])).toEqual(['MONTHLY', 'SEMIANNUAL']);
  });

  it('lets the same pending plan be chosen again for another period', () => {
    const pending = readMine({ subscription: { ...held, state: 'PENDING_PAYMENT', entitled: false } });
    const sub = pending?.subscription ?? null;
    expect(canChoose(sub, growth.id)).toBe(false);
    expect(canChoose(sub, growth.id, 'MONTHLY')).toBe(false);
    expect(canChoose(sub, growth.id, 'YEARLY')).toBe(true);
  });

  it('maps the new refusals', () => {
    expect(refusalOf(400, 'PERIOD_NOT_OFFERED')).toBe('periodNotOffered');
    expect(refusalOf(403, 'STUDENT_VERIFICATION_REQUIRED')).toBe('studentVerificationRequired');
  });
});

describe('extending a held subscription', () => {
  it('reads the renewal prices, shortest first, in the held currency', () => {
    const read = readMine({
      subscription: {
        ...held,
        paymentDue: 'RENEWAL',
        renewalPrices: [
          { billingPeriod: 'YEARLY', price: '228.00' },
          { billingPeriod: 'MONTHLY', price: '19.00', currency: 'AZN' },
          { billingPeriod: 'WEEKLY', price: '1.00' },
        ],
      },
    });
    expect(read?.subscription?.renewalPrices).toEqual([
      { billingPeriod: 'MONTHLY', price: '19.00', currency: 'AZN' },
      { billingPeriod: 'YEARLY', price: '228.00', currency: 'AZN' },
    ]);
  });

  it('reads an absent list as nothing to extend', () => {
    const { renewalPrices: _omit, ...older } = { ...held, renewalPrices: undefined };
    expect(readMine({ subscription: older })?.subscription?.renewalPrices).toEqual([]);
  });
});
