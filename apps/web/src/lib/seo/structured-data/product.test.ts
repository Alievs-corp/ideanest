import { describe, expect, it } from 'vitest';

import type { JsonLdNode } from './document';
import type { PublicRewardTier, RewardProductsInput } from './product';
import {
  PLEDGEABLE_PROJECT_STATES,
  REWARD_DESCRIPTION_MAX_LENGTH,
  rewardProductNodes,
} from './product';

const campaignUrl = 'https://ideanest.az/en/projects/ayan/studio';
/** The campaign's name rather than one of its four addresses — see `RewardProductsInput`. */
const campaignId = 'https://ideanest.az/projects/ayan/studio';

/** A deadline three weeks out, and a clock that agrees. */
const deadline = '2026-09-08T20:59:59Z';
const now = new Date('2026-08-18T09:00:00Z');

function tier(overrides: Partial<PublicRewardTier> = {}): PublicRewardTier {
  return {
    id: 'ffa5a1e2-0000-7000-8000-000000000001',
    title: 'The boxed set',
    description: 'Two glazed bowls and the poster.',
    price: { amount: '85.00', currency: 'AZN' },
    remainingQuantity: null,
    imageUrl: null,
    ...overrides,
  };
}

function nodes(overrides: Partial<RewardProductsInput> = {}): readonly JsonLdNode[] {
  return rewardProductNodes({
    campaignUrl,
    campaignId,
    campaignState: 'LIVE',
    deadline,
    tiers: [tier()],
    now,
    ...overrides,
  });
}

interface Offer {
  readonly '@type': string;
  readonly price: unknown;
  readonly priceCurrency: string;
  readonly availability: string;
  readonly url: string;
  readonly priceValidUntil?: string;
}

function offerOf(node: JsonLdNode | undefined): Offer {
  const offer = node?.['offers'];
  if (offer === undefined) throw new Error('the product carries no offer');
  return offer as unknown as Offer;
}

describe('PLEDGEABLE_PROJECT_STATES', () => {
  it('is the three states in which a pledge can actually be taken', () => {
    expect([...PLEDGEABLE_PROJECT_STATES]).toEqual(['LIVE', 'CLOSING_WINDOW', 'EXTENDED']);
  });
});

describe('rewardProductNodes', () => {
  it('describes the reward tier, not the campaign', () => {
    const [product] = nodes();

    expect(product?.['@type']).toBe('Product');
    expect(product?.['name']).toBe('The boxed set');
    expect(product?.['description']).toBe('Two glazed bowls and the poster.');
    expect(product?.['url']).toBe(campaignUrl);
  });

  it('identifies each tier under the campaign it belongs to', () => {
    expect(nodes()[0]?.['@id']).toBe(
      `${campaignId}#reward-ffa5a1e2-0000-7000-8000-000000000001`,
    );
  });

  it('escapes an identifier that would otherwise malform the fragment', () => {
    expect(nodes({ tiers: [tier({ id: 'a b#c' })] })[0]?.['@id']).toBe(
      `${campaignId}#reward-a%20b%23c`,
    );
  });

  it('carries the price as the decimal string the API sent, never as a number', () => {
    const offer = offerOf(nodes()[0]);

    expect(offer.price).toBe('85.00');
    expect(typeof offer.price).toBe('string');
    expect(offer.priceCurrency).toBe('AZN');
  });

  it('normalises the scale, so an amount written short still reads as money', () => {
    const tiers = [tier({ price: { amount: '85', currency: 'AZN' } })];
    expect(offerOf(nodes({ tiers })[0]).price).toBe('85.00');
  });

  it('offers a tier as a pre-order, because nobody is charged until the goal is met', () => {
    expect(offerOf(nodes()[0]).availability).toBe('https://schema.org/PreOrder');
  });

  it('says sold out once the last place is taken', () => {
    const tiers = [tier({ remainingQuantity: 0 })];
    expect(offerOf(nodes({ tiers })[0]).availability).toBe('https://schema.org/SoldOut');
  });

  it('says sold out for an over-subscribed count rather than offering a negative one', () => {
    const tiers = [tier({ remainingQuantity: -3 })];
    expect(offerOf(nodes({ tiers })[0]).availability).toBe('https://schema.org/SoldOut');
  });

  it('is still a pre-order while places remain', () => {
    const tiers = [tier({ remainingQuantity: 12 })];
    expect(offerOf(nodes({ tiers })[0]).availability).toBe('https://schema.org/PreOrder');
  });

  it('expires the price at the deadline, as a date', () => {
    expect(offerOf(nodes()[0]).priceValidUntil).toBe('2026-09-08');
  });

  it('claims no expiry for a campaign whose deadline has passed', () => {
    const passed = nodes({ campaignState: 'CLOSING_WINDOW', deadline: '2026-08-01T20:59:59Z' });
    expect(offerOf(passed[0])).not.toHaveProperty('priceValidUntil');
  });

  it('claims no expiry when there is no deadline to claim', () => {
    expect(offerOf(nodes({ deadline: null })[0])).not.toHaveProperty('priceValidUntil');
  });

  it('claims no expiry from a deadline that is not a date', () => {
    expect(offerOf(nodes({ deadline: 'soon' })[0])).not.toHaveProperty('priceValidUntil');
  });

  it('offers nothing for a campaign that is not taking pledges', () => {
    for (const state of [
      'DRAFT',
      'PRELAUNCH',
      'SCHEDULED',
      'SUCCESSFUL',
      'CANCELED',
      'COMPLETED',
      'LATE_PLEDGE',
    ]) {
      expect(nodes({ campaignState: state })).toEqual([]);
    }
  });

  it('offers a tier in the seven-day window and during an extension, which are funding like any other', () => {
    expect(nodes({ campaignState: 'CLOSING_WINDOW' })).toHaveLength(1);
    expect(nodes({ campaignState: 'EXTENDED' })).toHaveLength(1);
  });

  it('offers nothing for a state this build has never heard of', () => {
    expect(nodes({ campaignState: 'REFUNDING' })).toEqual([]);
  });

  it('is empty for a campaign with no tiers', () => {
    expect(nodes({ tiers: [] })).toEqual([]);
  });

  it('drops a tier whose price is not an amount', () => {
    const tiers = [
      tier({ id: '1', price: { amount: '', currency: 'AZN' } }),
      tier({ id: '2', price: { amount: '0.00', currency: 'AZN' } }),
      tier({ id: '3', price: { amount: '85,00', currency: 'AZN' } }),
      tier({ id: '4', price: { amount: 'free', currency: 'AZN' } }),
      tier({ id: '5', price: { amount: '85.00', currency: 'AZN' } }),
    ];

    expect(nodes({ tiers }).map((node) => node['@id'])).toEqual([`${campaignId}#reward-5`]);
  });

  it('drops a tier whose currency is not a currency code', () => {
    const tiers = [tier({ price: { amount: '85.00', currency: 'manat' } })];
    expect(nodes({ tiers })).toEqual([]);
  });

  it('drops a tier with nothing to call it', () => {
    expect(nodes({ tiers: [tier({ title: '  ' })] })).toEqual([]);
  });

  it('claims no description when the creator wrote none', () => {
    expect(nodes({ tiers: [tier({ description: null })] })[0]).not.toHaveProperty('description');
  });

  it('shortens a description rather than putting a page of prose in every response', () => {
    const description = 'ceramic '.repeat(200);
    const text = String(nodes({ tiers: [tier({ description })] })[0]?.['description']);

    expect(text.length).toBeLessThanOrEqual(REWARD_DESCRIPTION_MAX_LENGTH);
    expect(text).toMatch(/…$/u);
  });

  it('claims no image when the tier has none', () => {
    expect(nodes()[0]).not.toHaveProperty('image');
  });

  it('claims no image an unfurler could not fetch', () => {
    const tiers = [tier({ imageUrl: 'javascript:alert(1)' })];
    expect(nodes({ tiers })[0]).not.toHaveProperty('image');
  });

  it('carries an image the tier really has', () => {
    const tiers = [tier({ imageUrl: 'https://cdn.example/bowl.avif' })];
    expect(nodes({ tiers })[0]?.['image']).toBe('https://cdn.example/bowl.avif');
  });

  it('invents no rating, no review, no seller, and no brand', () => {
    const [product] = nodes();

    expect(product).not.toHaveProperty('aggregateRating');
    expect(product).not.toHaveProperty('review');
    expect(product).not.toHaveProperty('brand');
    expect(offerOf(product)).not.toHaveProperty('seller');
  });

  it('states no stock figure, which would be wrong within the hour', () => {
    const [product] = nodes({ tiers: [tier({ remainingQuantity: 12 })] });

    expect(offerOf(product)).not.toHaveProperty('inventoryLevel');
    expect(product).not.toHaveProperty('inventoryLevel');
  });
});
