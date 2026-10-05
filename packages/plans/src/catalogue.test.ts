import { describe, expect, it } from 'vitest';
import {
  blocksChoice,
  isFreePrice,
  isHeldPlan,
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

  it('blocks a second choice while anything but a cancelled plan is held', () => {
    expect(blocksChoice(null)).toBe(false);
    expect(blocksChoice(subscription)).toBe(true);
    expect(blocksChoice({ ...subscription, state: 'PENDING_PAYMENT' })).toBe(true);
    expect(blocksChoice({ ...subscription, state: 'CANCELED' })).toBe(false);
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
