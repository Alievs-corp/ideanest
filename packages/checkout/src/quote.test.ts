import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import type { PublicReward } from './types';
import {
  destinationOptions,
  quoteSelection,
  requiresDestination,
  toAmounts,
  unpricedLines,
  type Selection,
} from './quote';

/**
 * The client's preview of PL-06.
 *
 * WHY THIS IS TESTED AT ALL, given that the server's quote overrides it: because
 * a preview that disagrees with the server shows a backer one number and charges
 * them another, which is worse than showing no number. These cases are the same
 * ones `PledgeQuoteTests` pins on the service side — base and bonus, add-on
 * quantities, per-country shipping with an additional-item rate, a destination
 * nobody priced — so that the two implementations of one rule are held to it
 * separately.
 *
 * CLAUDE.md §3 makes money arithmetic non-optional to test for exactly this
 * reason: it fails silently and expensively.
 */

function reward(overrides: Partial<PublicReward> = {}): PublicReward {
  return {
    id: 'reward-1',
    title: 'Enamel mug',
    price: { amount: '45.00', currency: 'AZN' },
    shippingType: 'NONE',
    isEarlyBird: false,
    isFeatured: false,
    items: [],
    shippingRates: [],
    ...overrides,
  };
}

function selection(overrides: Partial<Selection> = {}): Selection {
  return {
    currency: 'AZN',
    reward: reward(),
    addons: [],
    contribution: new Decimal('45.00'),
    destination: null,
    ...overrides,
  };
}

describe('quoteSelection', () => {
  it('prices a tier at its own price, with nothing above it as a bonus', () => {
    const result = quoteSelection(selection());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.quote.base.toFixed(2)).toBe('45.00');
    expect(result.quote.bonus.toFixed(2)).toBe('0.00');
    expect(result.quote.total.toFixed(2)).toBe('45.00');
  });

  it('reads everything above the tier price as PL-03 bonus support', () => {
    const result = quoteSelection(selection({ contribution: new Decimal('60.00') }));
    if (!result.ok) throw new Error('the selection should have priced');

    expect(result.quote.base.toFixed(2)).toBe('45.00');
    expect(result.quote.bonus.toFixed(2)).toBe('15.00');
    expect(result.quote.total.toFixed(2)).toBe('60.00');
  });

  it('refuses a contribution below the tier price rather than charging the price', () => {
    // Clamping up would charge more than the figure the backer was looking at;
    // clamping down would take the tier for less than it costs. `PledgeQuote`
    // refuses it on the service for the same reason.
    const result = quoteSelection(selection({ contribution: new Decimal('20.00') }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.reason).toBe('contribution-below-price');
  });

  it('makes a support-only pledge its own base, with no bonus (PL-02)', () => {
    /*
     * Not a zero base with the whole amount as a bonus. `PledgeQuote.baseOf`
     * gives the reason: every report of "raised through rewards versus raised as
     * support" would otherwise read a support-only pledge as a bonus on a reward
     * nobody took.
     */
    const result = quoteSelection(
      selection({ reward: null, contribution: new Decimal('12.50') }),
    );
    if (!result.ok) throw new Error('a support-only pledge is a pledge');

    expect(result.quote.base.toFixed(2)).toBe('12.50');
    expect(result.quote.bonus.toFixed(2)).toBe('0.00');
    expect(result.quote.total.toFixed(2)).toBe('12.50');
  });

  it('refuses a pledge that comes to nothing', () => {
    const result = quoteSelection(
      selection({ reward: null, contribution: new Decimal('0') }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.reason).toBe('nothing-pledged');
  });

  it('sums add-ons as price times quantity', () => {
    const result = quoteSelection(
      selection({
        addons: [
          { reward: reward({ id: 'a1', price: { amount: '8.50', currency: 'AZN' } }), quantity: 3 },
          { reward: reward({ id: 'a2', price: { amount: '2.25', currency: 'AZN' } }), quantity: 2 },
        ],
      }),
    );
    if (!result.ok) throw new Error('the selection should have priced');

    // 8.50 × 3 = 25.50, 2.25 × 2 = 4.50
    expect(result.quote.addons.toFixed(2)).toBe('30.00');
    expect(result.quote.total.toFixed(2)).toBe('75.00');
  });

  it('ignores an add-on nobody asked for', () => {
    const result = quoteSelection(
      selection({ addons: [{ reward: reward({ id: 'a1' }), quantity: 0 }] }),
    );
    if (!result.ok) throw new Error('the selection should have priced');

    expect(result.quote.addons.toFixed(2)).toBe('0.00');
  });
});

describe('shipping', () => {
  const posted = reward({
    id: 'posted',
    shippingType: 'INTERNATIONAL',
    shippingRates: [
      { countryCode: 'AZ', amount: '5.00', additionalItemAmount: '2.00' },
      { countryCode: 'TR', amount: '9.00', additionalItemAmount: '3.00' },
    ],
  });

  it('is asked for only when something in the selection is posted (PL-05)', () => {
    expect(requiresDestination(selection())).toBe(false);
    expect(requiresDestination(selection({ reward: reward({ shippingType: 'DIGITAL' }) }))).toBe(
      false,
    );
    expect(
      requiresDestination(selection({ reward: reward({ shippingType: 'LOCAL_PICKUP' }) })),
    ).toBe(false);
    expect(requiresDestination(selection({ reward: posted }))).toBe(true);
  });

  it('is asked for when an add-on is posted even though the reward is not', () => {
    const digital = selection({
      reward: reward({ shippingType: 'DIGITAL' }),
      addons: [{ reward: posted, quantity: 1 }],
    });

    expect(requiresDestination(digital)).toBe(true);
  });

  it('refuses to price a posted selection with no destination', () => {
    const result = quoteSelection(selection({ reward: posted }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.reason).toBe('destination-missing');
  });

  it('charges the first unit at the rate and every one after it at the additional rate', () => {
    const result = quoteSelection(
      selection({
        reward: posted,
        destination: 'AZ',
        addons: [{ reward: posted, quantity: 3 }],
      }),
    );
    if (!result.ok) throw new Error('the selection should have priced');

    // The reward is one unit at 5.00. The add-on is three: 5.00 + 2.00 × 2.
    expect(result.quote.shipping.toFixed(2)).toBe('14.00');
  });

  it('treats an absent additional-item amount as a flat rate', () => {
    const flat = reward({
      id: 'flat',
      shippingType: 'DOMESTIC',
      shippingRates: [{ countryCode: 'AZ', amount: '6.00' }],
    });

    const result = quoteSelection(
      selection({ reward: null, contribution: new Decimal('10.00'), destination: 'AZ', addons: [{ reward: flat, quantity: 4 }] }),
    );
    if (!result.ok) throw new Error('the selection should have priced');

    expect(result.quote.shipping.toFixed(2)).toBe('6.00');
  });

  it('refuses a destination the creator has not priced, and names the line', () => {
    const result = quoteSelection(selection({ reward: posted, destination: 'DE' }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.reason).toBe('destination-unpriced');
    if (result.refusal.reason !== 'destination-unpriced') return;
    // Named, because a refusal that cannot say what to remove is a dead end.
    expect(result.refusal.lines).toEqual(['Enamel mug']);
    expect(result.refusal.destination).toBe('DE');
  });

  it('offers every destination any selected line prices, not only the ones they share', () => {
    const local = reward({
      id: 'local',
      title: 'Poster',
      shippingType: 'DOMESTIC',
      shippingRates: [{ countryCode: 'AZ', amount: '3.00', additionalItemAmount: '0.00' }],
    });

    const mixed = selection({ reward: posted, addons: [{ reward: local, quantity: 1 }] });

    expect(destinationOptions(mixed)).toEqual(['AZ', 'TR']);
    // Turkey is offered and then refused BY NAME, which is the difference
    // between "we do not ship there" and "remove the poster and we do".
    expect(unpricedLines(mixed, 'TR')).toEqual(['Poster']);
  });

  it('adds no shipping for a pledge that posts nothing', () => {
    const result = quoteSelection(selection({ destination: 'AZ' }));
    if (!result.ok) throw new Error('the selection should have priced');

    expect(result.quote.shipping.toFixed(2)).toBe('0.00');
  });
});

describe('the arithmetic a double gets wrong', () => {
  it('totals exactly where floating point does not', () => {
    const posted = reward({
      id: 'posted',
      price: { amount: '45.05', currency: 'AZN' },
      shippingType: 'DOMESTIC',
      shippingRates: [{ countryCode: 'AZ', amount: '5.05', additionalItemAmount: '2.15' }],
    });

    const result = quoteSelection({
      currency: 'AZN',
      reward: posted,
      addons: [
        {
          reward: reward({
            id: 'addon',
            price: { amount: '8.10', currency: 'AZN' },
            shippingType: 'DOMESTIC',
            shippingRates: [{ countryCode: 'AZ', amount: '0.00', additionalItemAmount: '0.00' }],
          }),
          quantity: 3,
        },
      ],
      contribution: new Decimal('45.05'),
      destination: 'AZ',
    });
    if (!result.ok) throw new Error('the selection should have priced');

    /*
     * THE POINT OF THIS CASE. The same sum in IEEE 754 doubles comes to
     * 74.39999999999999 — `8.1 * 3` is already 24.299999999999997 before
     * anything is added to it. The assertion below is not decoration: it is the
     * failure this module exists to prevent, asserted as a fact about the
     * platform rather than left as folklore in a comment.
     */
    expect(45.05 + 8.1 * 3 + 5.05).not.toBe(74.4);

    expect(result.quote.base.toFixed(2)).toBe('45.05');
    expect(result.quote.addons.toFixed(2)).toBe('24.30');
    expect(result.quote.shipping.toFixed(2)).toBe('5.05');
    expect(result.quote.total.toFixed(2)).toBe('74.40');
    expect(result.quote.total.equals(new Decimal('74.40'))).toBe(true);
  });
});

describe('toAmounts', () => {
  it('hands the preview over in the shape the server answers with', () => {
    const result = quoteSelection(selection({ contribution: new Decimal('50.00') }));
    if (!result.ok) throw new Error('the selection should have priced');

    // Strings at the wire's scale, never numbers (§10.3).
    expect(toAmounts(result.quote)).toEqual({
      base: { amount: '45.00', currency: 'AZN' },
      addons: { amount: '0.00', currency: 'AZN' },
      bonus: { amount: '5.00', currency: 'AZN' },
      shipping: { amount: '0.00', currency: 'AZN' },
      tax: { amount: '0.00', currency: 'AZN' },
      total: { amount: '50.00', currency: 'AZN' },
    });
  });
});
