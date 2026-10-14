import { describe, expect, it } from 'vitest';
import { DELIVERY_MONTH_OPTIONS, readRewardDetails } from './reward-details';

/**
 * The reward card's details — #255. When it arrives, where it can be sent and from what, and
 * the checkout's two tags, read from the public reward response the same way on both clients.
 */

const rate = (countryCode: string, amount: string) => ({ countryCode, amount, additionalItemAmount: null });

describe('the shipping line', () => {
  it('counts the destinations the creator priced and quotes the cheapest, as a decimal', () => {
    const details = readRewardDetails({
      shippingType: 'INTERNATIONAL',
      shippingRates: [rate('AZ', '5.00'), rate('GE', '12.50'), rate('TR', '4.90'), rate('az', '6.00')],
    });

    // AZ twice is one country; the cheapest is compared as a decimal, not as text.
    expect(details.shipping).toEqual({ kind: 'ships', countries: 3, lowestRate: '4.9' });
  });

  it('compares amounts as decimals, so "10.00" is not cheaper than "9.00"', () => {
    const details = readRewardDetails({
      shippingType: 'DOMESTIC',
      shippingRates: [rate('AZ', '10.00'), rate('AZ', '9.00')],
    });
    expect(details.shipping).toEqual({ kind: 'ships', countries: 1, lowestRate: '9' });
  });

  it('keeps a free destination as the lowest rate, which is zero, not "none"', () => {
    const details = readRewardDetails({ shippingType: 'DOMESTIC', shippingRates: [rate('AZ', '0.00')] });
    expect(details.shipping).toEqual({ kind: 'ships', countries: 1, lowestRate: '0' });
  });

  it('counts a destination whose amount it cannot read, without quoting it', () => {
    const details = readRewardDetails({
      shippingType: 'INTERNATIONAL',
      shippingRates: [{ countryCode: 'GE', amount: 12.5 }],
    });
    expect(details.shipping).toEqual({ kind: 'ships', countries: 1, lowestRate: null });
  });

  it('says nothing about a shipped tier with nowhere priced yet', () => {
    expect(readRewardDetails({ shippingType: 'INTERNATIONAL', shippingRates: [] }).shipping).toEqual({
      kind: 'unpriced',
    });
  });

  it('names what is not shipped: digital, collected in person, or nothing at all', () => {
    expect(readRewardDetails({ shippingType: 'DIGITAL', shippingRates: [] }).shipping).toEqual({ kind: 'digital' });
    expect(readRewardDetails({ shippingType: 'LOCAL_PICKUP' }).shipping).toEqual({ kind: 'pickup' });
    expect(readRewardDetails({ shippingType: 'NONE' }).shipping).toEqual({ kind: 'none' });
  });

  it('says nothing for a type this build has never heard of', () => {
    expect(readRewardDetails({ shippingType: 'TELEPORT' }).shipping).toEqual({ kind: 'unpriced' });
  });
});

describe('the delivery month and the tags', () => {
  it('keeps a plain date and drops anything else', () => {
    expect(readRewardDetails({ estimatedDelivery: '2026-11-01' }).estimatedDelivery).toBe('2026-11-01');
    expect(readRewardDetails({ estimatedDelivery: null }).estimatedDelivery).toBeNull();
    expect(readRewardDetails({ estimatedDelivery: 'soon' }).estimatedDelivery).toBeNull();
  });

  it('formats in UTC, so the first of a month stays in that month everywhere', () => {
    const month = new Intl.DateTimeFormat('en', DELIVERY_MONTH_OPTIONS).format(new Date('2026-11-01'));
    expect(month).toBe('November 2026');
  });

  it('reads the two flags only when they are true', () => {
    expect(readRewardDetails({ isEarlyBird: true, isFeatured: true })).toMatchObject({
      earlyBird: true,
      featured: true,
    });
    expect(readRewardDetails({ isEarlyBird: 'yes' })).toMatchObject({ earlyBird: false, featured: false });
  });

  it('answers a card with nothing to add for a row that is not an object', () => {
    expect(readRewardDetails(null)).toEqual({
      estimatedDelivery: null,
      shipping: { kind: 'unpriced' },
      earlyBird: false,
      featured: false,
    });
  });
});
