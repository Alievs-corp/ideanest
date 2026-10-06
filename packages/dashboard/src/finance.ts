import type { components } from '@ideanest/api-client';
import type { Money } from '@ideanest/money';

/**
 * §4.7's CD-16: what a campaign took, what came off it, and what is left — issue #99.
 *
 * Read from `GET /v1/projects/{id}/finance`, which is guarded by `VIEW_FINANCES` — the same
 * capability the backer report takes, and for the same reason: this is money, and a
 * collaborator brought on to write the story has no business reading it.
 *
 * <h2>Two things the screen has to respect, and this module makes explicit</h2>
 *
 * <strong>`basis` is not decoration.</strong> Before a payout has been calculated the fees are
 * what §5.2's current schedule *would* charge; afterwards they are what the payout *was*
 * priced at. Those are different statements, and a panel that presented them identically
 * would be lying on one of the two days it matters. Nothing in this module collapses them.
 *
 * <strong>Money stays a string.</strong> Every amount arrives as `{amount, currency}` and is
 * kept that way. CLAUDE.md §3: a JSON number is a double, and a double is where a pledge's
 * last qapik goes. Anything that needs arithmetic does it in `decimal.js`.
 */

type ContractFinance = components['schemas']['CampaignFinanceResponse'];

/** Whether these figures are what a payout would be, or what one was. */
export type FinanceBasis = 'PROJECTED' | 'SETTLED';

/** One payout, as much of it as the campaign's team is shown. */
export interface FinancePayout {
  readonly id: string;
  /** One of §9.5's payout states, widened so an unknown one renders rather than vanishing. */
  readonly state: string;
  readonly net: Money;
  /** ISO-8601 instants. `sentAt` is null for a payout that has not left yet. */
  readonly calculatedAt: string | null;
  readonly sentAt: string | null;
}

/** One of §7.2's accounts, as it stands for this campaign. */
export interface FinanceBalance {
  readonly account: string;
  /** Debits positive, credits negative. A negative creator balance is money held for them. */
  readonly net: Money;
}

export interface CampaignFinance {
  readonly basis: FinanceBasis;
  readonly currency: string;
  readonly gross: Money;
  readonly refunded: Money;
  readonly platformFee: Money;
  readonly processingFee: Money;
  readonly taxWithheld: Money;
  /**
   * Whether the platform withholds any tax at all. Always false today — §4.10 is #78 and is
   * blocked on a legal answer — and the panel says so in words rather than printing a bare
   * zero, because "no tax was due" and "we withhold none" are different sentences to put in
   * front of somebody who has to file a return.
   */
  readonly taxCollected: boolean;
  readonly net: Money;
  readonly paidOut: Money;
  /** Which version of §5.2's rates produced the fees. Null when none was configured. */
  readonly feeScheduleId: string | null;
  /** Newest first, whatever became of each one. */
  readonly payouts: readonly FinancePayout[];
  readonly ledger: readonly FinanceBalance[];
  /** Whether this campaign's ledger entries balance. See the service for what a false means. */
  readonly reconciled: boolean;
  readonly computedAt: string | null;
}

/**
 * The wire shape, narrowed once.
 *
 * Both clients read through this: the web's `getFinance` and the app's finance panel (#163).
 * Every field of the generated type is optional — springdoc marks a record component required
 * only when it can prove it — so this is where an absent figure becomes a zero rather than
 * every component that draws one narrowing it again and eventually forgetting.
 */
export function readFinance(body: ContractFinance): CampaignFinance {
  const currency = body.currency ?? 'AZN';

  return {
    basis: body.basis === 'SETTLED' ? 'SETTLED' : 'PROJECTED',
    currency,
    gross: money(body.gross, currency),
    refunded: money(body.refunded, currency),
    platformFee: money(body.platformFee, currency),
    processingFee: money(body.processingFee, currency),
    taxWithheld: money(body.taxWithheld, currency),
    taxCollected: body.taxCollected ?? false,
    net: money(body.net, currency),
    paidOut: money(body.paidOut, currency),
    feeScheduleId: body.feeScheduleId ?? null,
    payouts: (body.payouts ?? []).map((payout) => ({
      id: payout.id ?? '',
      state: payout.state ?? 'CALCULATED',
      net: money(payout.net, currency),
      calculatedAt: payout.calculatedAt ?? null,
      sentAt: payout.sentAt ?? null,
    })),
    ledger: (body.ledger ?? []).map((balance) => ({
      account: balance.account ?? '',
      net: money(balance.net, currency),
    })),
    /*
     * `!== false` rather than `?? true`: an absent field is a service that does not publish
     * the check yet, and claiming books are unbalanced on that basis would put a warning in
     * front of a creator about nothing. An explicit false is the only false.
     */
    reconciled: body.reconciled !== false,
    computedAt: body.computedAt ?? null,
  };
}

/**
 * An amount, or a zero in the campaign's currency.
 *
 * The string is never parsed here. A missing amount becomes `'0.00'` rather than `'0'`, so
 * every figure on the panel has the same number of decimals whether it arrived or not — a
 * column of amounts where one is shorter reads as a rendering fault.
 */
function money(value: ContractFinance['gross'], currency: string): Money {
  if (value === undefined || typeof value.amount !== 'string') return { amount: '0.00', currency };
  return { amount: value.amount, currency: value.currency ?? currency };
}

/** §9.5's payout states, in the order a payout moves through them. */
export const PAYOUT_STATES = [
  'CALCULATED',
  'PENDING_APPROVAL',
  'APPROVED',
  'PAID',
  'FAILED',
  'CANCELLED',
] as const;

export type PayoutState = (typeof PAYOUT_STATES)[number];

/** Whether a state is one the clients have words for. An unknown one is printed as it came. */
export function isPayoutState(state: string): state is PayoutState {
  return (PAYOUT_STATES as readonly string[]).includes(state);
}

/** The instant a payout row shows: when it was sent, or, until then, when it was calculated. */
export function payoutInstant(payout: FinancePayout): string | null {
  return payout.sentAt ?? payout.calculatedAt;
}
