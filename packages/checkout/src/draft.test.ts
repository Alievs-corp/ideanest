import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { draftBodyFor } from './draft';
import type { PublicReward } from './types';

function tier(id: string, price: string): PublicReward {
  return {
    id,
    title: id,
    price: { amount: price, currency: 'AZN' },
    shippingType: 'NONE',
    isEarlyBird: false,
    isFeatured: false,
    items: [],
    shippingRates: [],
  };
}

describe('draftBodyFor', () => {
  it('builds the web body: sorted positive add-ons, a string contribution, no referrer', () => {
    const body = draftBodyFor(
      'p1',
      {
        currency: 'AZN',
        reward: tier('r1', '45.00'),
        addons: [
          { reward: tier('z', '5.00'), quantity: 1 },
          { reward: tier('a', '3.00'), quantity: 2 },
          { reward: tier('m', '3.00'), quantity: 0 },
        ],
        contribution: new Decimal('50'),
        destination: 'AZ',
      },
      false,
      true,
    );
    expect(body).toEqual({
      projectId: 'p1',
      rewardTierId: 'r1',
      addons: [
        { rewardTierId: 'a', quantity: 2 },
        { rewardTierId: 'z', quantity: 1 },
      ],
      contribution: { amount: '50.00', currency: 'AZN' },
      shippingCountry: null,
      isAnonymous: true,
      referrerCode: null,
    });
  });

  it('sends the destination only when one is needed', () => {
    const selection = {
      currency: 'AZN',
      reward: null,
      addons: [],
      contribution: new Decimal('10'),
      destination: 'AZ',
    };
    expect(draftBodyFor('p1', selection, true, false).shippingCountry).toBe('AZ');
    expect(draftBodyFor('p1', selection, false, false).rewardTierId).toBeNull();
  });
});
