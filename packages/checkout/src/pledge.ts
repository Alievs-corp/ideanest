import type { ExchangeRate } from '@ideanest/money';
import type { PledgeRaise, PledgeResponse } from './types';

export type PaymentReturnHint = 'returned' | 'failed';

export const PAYMENT_CHECKS = 20;
export const PAYMENT_CHECK_INTERVAL_MS = 3000;

const EDITABLE: ReadonlySet<string> = new Set(['DRAFT', 'CONFIRMED']);

export function isEditable(state: string): boolean {
  return EDITABLE.has(state);
}

export function isRaisable(pledge: Pick<PledgeResponse, 'state' | 'raisable'>): boolean {
  return pledge.state === 'COLLECTED' && pledge.raisable === true;
}

export function isDisputable(state: string): boolean {
  return state === 'COLLECTED';
}

export type PledgeTone = 'default' | 'success' | 'warning' | 'danger';

const TONES: Readonly<Record<string, PledgeTone>> = {
  DRAFT: 'warning',
  CHARGE_PENDING: 'warning',
  CHARGE_FAILED: 'danger',
  COLLECTED: 'success',
  FULFILLED: 'success',
};

export function pledgeTone(state: string): PledgeTone {
  return TONES[state] ?? 'default';
}

export type ChargeNote = 'charged' | 'notCharged';

export function chargeNoteOf(state: string): ChargeNote | null {
  if (state === 'COLLECTED' || state === 'FULFILLED') return 'charged';
  if (state === 'DRAFT' || state === 'EXPIRED' || state === 'CANCELED_BY_BACKER') return 'notCharged';
  return null;
}

export function readReturnHint(value: unknown): PaymentReturnHint | null {
  return value === 'returned' || value === 'failed' ? value : null;
}

export type PaymentReturnOutcome = 'paid' | 'waiting' | 'failed';

export function paymentReturnOutcome(hint: PaymentReturnHint, state: string): PaymentReturnOutcome | null {
  if (state === 'COLLECTED') return 'paid';
  if (hint === 'returned' && state === 'DRAFT') return 'waiting';
  if (state === 'DRAFT' || state === 'EXPIRED') return 'failed';
  return null;
}

export type RaiseReturnOutcome = 'raised' | 'unapplied' | 'waiting' | 'held' | 'failed';

const RAISE_NOT_CHARGED: ReadonlySet<string> = new Set(['FAILED', 'EXPIRED', 'ABANDONED']);

export function raiseReturnOutcome(
  hint: PaymentReturnHint,
  raise: PledgeRaise | null | undefined,
  now: number,
): RaiseReturnOutcome | null {
  if (raise == null) return null;
  if (raise.state === 'SUCCEEDED') return 'raised';
  if (raise.state === 'UNAPPLIED') return 'unapplied';
  if (raise.state === 'PENDING') {
    if (hint === 'returned') return 'waiting';
    return Date.parse(raise.holdExpiresAt) > now ? 'held' : 'failed';
  }
  return RAISE_NOT_CHARGED.has(raise.state) ? 'failed' : null;
}

export function isSettling(
  pledge: Pick<PledgeResponse, 'state' | 'latestRaise'>,
  payment: PaymentReturnHint | null,
  raise: PaymentReturnHint | null,
): boolean {
  return (
    (payment === 'returned' && pledge.state === 'DRAFT') ||
    (raise !== null && pledge.latestRaise?.state === 'PENDING')
  );
}

export function raiseInFlight(pledge: Pick<PledgeResponse, 'latestRaise'>, now: number): boolean {
  const latest = pledge.latestRaise;
  return latest != null && latest.state === 'PENDING' && Date.parse(latest.holdExpiresAt) > now;
}

export function quotedRate(pledge: Pick<PledgeResponse, 'displayCurrency' | 'displayRate'>): ExchangeRate | null {
  const currency = pledge.displayCurrency;
  const rate = pledge.displayRate;
  return currency == null || rate == null ? null : { currency, rate, publishedFor: '' };
}
