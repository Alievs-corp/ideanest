import { describe, expect, it } from 'vitest';
import { PAYOUT_STATES, isPayoutState, payoutInstant, readFinance } from './finance';

/**
 * The wire shape of §4.7's CD-16, narrowed once — issue #99.
 *
 * WHAT THESE COVER:
 *
 *   - **money stays a string.** Every amount arrives as a decimal string and is kept as one.
 *     CLAUDE.md §3: a JSON number is a double, and a double is where a pledge's last qapik
 *     goes.
 *   - **an absent figure is a zero with the campaign's currency**, at the campaign's number of
 *     decimals. A column of amounts where one is `0` and the rest are `0.00` reads as a
 *     rendering fault.
 *   - **an absent `reconciled` is not an unbalanced ledger.** Every field of the generated type
 *     is optional, because springdoc marks a record component required only when it can prove
 *     it — so "the service did not say" must not become a warning in front of a creator about
 *     nothing.
 */

describe('reading a financial summary', () => {
  const body = {
    projectId: '0193f2a1-0000-7000-8000-000000000001',
    basis: 'SETTLED' as const,
    currency: 'AZN',
    gross: { amount: '10000.00', currency: 'AZN' },
    refunded: { amount: '250.00', currency: 'AZN' },
    platformFee: { amount: '500.00', currency: 'AZN' },
    processingFee: { amount: '290.00', currency: 'AZN' },
    taxWithheld: { amount: '0.00', currency: 'AZN' },
    taxCollected: false,
    net: { amount: '8960.00', currency: 'AZN' },
    paidOut: { amount: '8960.00', currency: 'AZN' },
    reconciled: true,
    computedAt: '2026-08-20T12:00:00.000Z',
  };

  it('keeps every amount as the string it arrived as', () => {
    const finance = readFinance(body);

    expect(finance.gross).toEqual({ amount: '10000.00', currency: 'AZN' });
    expect(typeof finance.net.amount).toBe('string');
  });

  it('reads the basis, and treats anything that is not SETTLED as a projection', () => {
    expect(readFinance(body).basis).toBe('SETTLED');
    expect(readFinance({ ...body, basis: undefined }).basis).toBe('PROJECTED');
  });

  it('fills an absent amount with a zero at the same number of decimals', () => {
    const finance = readFinance({ currency: 'AZN' });

    expect(finance.gross).toEqual({ amount: '0.00', currency: 'AZN' });
    expect(finance.net).toEqual({ amount: '0.00', currency: 'AZN' });
    expect(finance.payouts).toEqual([]);
    expect(finance.ledger).toEqual([]);
  });

  /** "The service did not say" must not become a warning about nothing. */
  it('treats an absent reconciliation as nothing to report, and only an explicit false as false', () => {
    expect(readFinance({ ...body, reconciled: undefined }).reconciled).toBe(true);
    expect(readFinance({ ...body, reconciled: false }).reconciled).toBe(false);
  });

  it('reads a payout that has not been sent as one with no sending instant', () => {
    const finance = readFinance({
      ...body,
      payouts: [
        {
          id: 'p1',
          state: 'CALCULATED',
          net: { amount: '8960.00', currency: 'AZN' },
          calculatedAt: '2026-08-18T10:00:00.000Z',
        },
      ],
    });

    expect(finance.payouts[0]?.sentAt).toBeNull();
    expect(finance.payouts[0]?.state).toBe('CALCULATED');
  });

  it('keeps a ledger balance signed the way the ledger signs it', () => {
    const finance = readFinance({
      ...body,
      ledger: [{ account: 'creator:abc', net: { amount: '-10000.00', currency: 'AZN' } }],
    });

    // Negative on a creator's account is money the platform holds for them, and the sign is
    // the whole of that statement.
    expect(finance.ledger[0]?.net.amount).toBe('-10000.00');
  });
});

describe('a payout row', () => {
  const payout = {
    id: 'p1',
    state: 'PAID',
    net: { amount: '8960.00', currency: 'AZN' },
    calculatedAt: '2026-08-18T10:00:00.000Z',
    sentAt: null,
  };

  it('shows when it was sent, and until then when it was calculated', () => {
    expect(payoutInstant(payout)).toBe('2026-08-18T10:00:00.000Z');
    expect(payoutInstant({ ...payout, sentAt: '2026-08-20T09:00:00.000Z' })).toBe('2026-08-20T09:00:00.000Z');
    expect(payoutInstant({ ...payout, calculatedAt: null })).toBeNull();
  });

  it('knows the six payout states, and nothing else', () => {
    expect(PAYOUT_STATES.every(isPayoutState)).toBe(true);
    expect(isPayoutState('REVERSED')).toBe(false);
  });
});
