import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import messages from '@ideanest/messages/en.json';
import type { PledgeAmounts } from '../../lib/pledges/api';
import { PledgeSummary } from './PledgeSummary';

/**
 * §21.2's approximation, as the checkout panel draws it — issue #327.
 *
 * <p>The panel had no test of its own: it is a presentational component whose lines are
 * covered through `CheckoutView`. What #327 adds to it is the one thing on this platform
 * that must never be mistaken for a price, so it gets assertions of its own:
 *
 * <ul>
 *   <li>the chargeable total is always there and always unqualified;
 *   <li>the approximation is marked as one, in a character rather than a word — and named
 *       in words for a screen reader, which would announce `≈` as nothing at all;
 *   <li>nothing is drawn when there is no approximation, which is the ordinary case.
 * </ul>
 */

const copy = messages.checkout.summary;

function amounts(total: string): PledgeAmounts {
  const zero = { amount: '0.00', currency: 'AZN' };
  return {
    base: { amount: total, currency: 'AZN' },
    addons: zero,
    bonus: zero,
    shipping: zero,
    tax: zero,
    total: { amount: total, currency: 'AZN' },
  };
}

describe('the approximation', () => {
  it('is drawn under the total, marked as approximate', () => {
    render(
      <PledgeSummary
        copy={copy}
        amounts={amounts('50.00')}
        source="quoted"
        rewardTitle={null}
        approximateTotal={{ amount: '29.41', currency: 'USD' }}
      />,
    );

    // Twice: the base line and the total. Both unqualified, because both are figures a
    // card is charged.
    expect(screen.getAllByText('50.00 AZN')).toHaveLength(2);
    // And the one that is not, with the sign that says so.
    expect(screen.getByText('≈ 29.41 USD')).toBeInTheDocument();
  });

  it('says "approximately" to a screen reader, which cannot read the sign', () => {
    render(
      <PledgeSummary
        copy={copy}
        amounts={amounts('50.00')}
        source="quoted"
        rewardTitle={null}
        approximateTotal={{ amount: '29.41', currency: 'USD' }}
      />,
    );

    // CLAUDE.md §2: meaning never rides on something the assistive layer cannot reach, and
    // `≈` is announced as nothing at all by most screen readers — so a reader would hear
    // two totals with no word between them.
    expect(screen.getByLabelText('Approximately 29.41 USD')).toBeInTheDocument();
  });

  it('draws nothing when there is no approximation, which is most pledges', () => {
    render(
      <PledgeSummary copy={copy} amounts={amounts('50.00')} source="quoted" rewardTitle={null} />,
    );

    expect(screen.getAllByText('50.00 AZN')).toHaveLength(2);
    expect(screen.queryByText(/≈/)).not.toBeInTheDocument();
  });
});
