import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { changesFrom, draftOf, isEmptyEdit, raiseDifference } from './edit';
import { NO_REWARD } from './draft';
import type { PledgeResponse } from './types';

const money = (amount: string) => ({ amount, currency: 'AZN' });

function pledge(overrides: Partial<PledgeResponse> = {}): PledgeResponse {
  return {
    id: 'p1',
    projectId: 'proj',
    state: 'CONFIRMED',
    rewardTierId: 'tier',
    addons: [
      { rewardTierId: 'b', quantity: 1 },
      { rewardTierId: 'a', quantity: 2 },
    ],
    amounts: {
      base: money('40.00'),
      addons: money('10.00'),
      bonus: money('5.00'),
      shipping: money('3.00'),
      tax: money('0.00'),
      total: money('58.00'),
    },
    shippingCountry: 'AZ',
    isAnonymous: false,
    cardVerified: false,
    latePledge: false,
    supplements: [],
    ...overrides,
  };
}

describe('changesFrom', () => {
  it('is empty with no change', () => {
    expect(changesFrom(pledge(), draftOf(pledge()), new Decimal('45.00'))).toEqual({});
  });

  it('sends rewardTierId null to drop the reward', () => {
    const edit = changesFrom(pledge(), { ...draftOf(pledge()), choice: NO_REWARD }, new Decimal('45'));
    expect(edit).toEqual({ rewardTierId: null });
    expect(JSON.stringify(edit)).toBe('{"rewardTierId":null}');
  });

  it('ignores add-ons that differ only in order', () => {
    const draft = { ...draftOf(pledge()), addons: [...pledge().addons].reverse() };
    expect(changesFrom(pledge(), draft, new Decimal('45.00'))).toEqual({});
  });

  it('sends the full sorted list when a quantity changes', () => {
    const draft = {
      ...draftOf(pledge()),
      addons: [
        { rewardTierId: 'b', quantity: 3 },
        { rewardTierId: 'a', quantity: 2 },
        { rewardTierId: 'c', quantity: 0 },
      ],
    };
    expect(changesFrom(pledge(), draft, new Decimal('45.00'))).toEqual({
      addons: [
        { rewardTierId: 'a', quantity: 2 },
        { rewardTierId: 'b', quantity: 3 },
      ],
    });
  });

  it('compares the contribution with Decimal equality', () => {
    expect(changesFrom(pledge(), draftOf(pledge()), new Decimal('45.0'))).toEqual({});
    expect(changesFrom(pledge(), draftOf(pledge()), new Decimal('50'))).toEqual({
      contribution: money('50.00'),
    });
  });

  it('sends shippingCountry null to clear the destination', () => {
    expect(changesFrom(pledge(), { ...draftOf(pledge()), destination: null }, new Decimal('45'))).toEqual({
      shippingCountry: null,
    });
  });

  it('sends the anonymity flag only when it changed', () => {
    expect(changesFrom(pledge(), { ...draftOf(pledge()), isAnonymous: true }, new Decimal('45'))).toEqual({
      isAnonymous: true,
    });
  });
});

describe('draftOf', () => {
  it('seeds from the pledge, with no reward as NO_REWARD', () => {
    expect(draftOf(pledge({ rewardTierId: null, shippingCountry: null }))).toEqual({
      choice: NO_REWARD,
      contributionText: '45.00',
      addons: pledge().addons,
      destination: null,
      isAnonymous: false,
    });
  });
});

describe('isEmptyEdit and raiseDifference', () => {
  it('reads an empty edit', () => {
    expect(isEmptyEdit({})).toBe(true);
    expect(isEmptyEdit({ isAnonymous: false })).toBe(false);
  });

  it('is the preview total less the pledge total, in decimals', () => {
    expect(raiseDifference(new Decimal('58.30'), pledge()).toFixed(2)).toBe('0.30');
    expect(raiseDifference(new Decimal('50'), pledge()).isNegative()).toBe(true);
  });
});
