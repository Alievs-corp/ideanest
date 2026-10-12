import { authorizedFetch } from '../api/client';
import { errorFrom } from '../api/problem';
import type { Money } from '../money';
import type { DestinationKind } from './api';

/**
 * §4.11's AD-05 payout queue — issues #69 and #306.
 *
 * <h2>What the screen has to show, and why it is every figure</h2>
 *
 * This is where somebody signs off money leaving the platform. A single net figure with a
 * note saying "fees deducted" is not something anybody can check, so the service sends the
 * whole breakdown and the screen renders all of it: what came in, what the platform took,
 * what the processor took, what went back as refunds, and what is left.
 *
 * <h2>Dual approval is two rows and cannot be one person</h2>
 *
 * The service makes `(payout, approver)` a primary key, so "two different people" is a
 * constraint rather than a rule somebody has to remember. `stillNeeded` comes from the
 * service rather than being counted here, because the browser cannot see that two rows are
 * two different accounts.
 */

export type PayoutState =
  | 'CALCULATED'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'PAID'
  | 'FAILED'
  | 'CANCELLED';

/**
 * Where a payout's creator stands with identity verification — issue #431.
 *
 * Eight values and not a boolean, because a finance operator looking at a payout that will
 * not approve has to be able to tell a creator who has never been asked from one whose
 * documents are already in the review queue: those are different things to do next. V55's
 * argument, which #431 quotes — a payout that will not approve and does not say why "makes
 * the same campaign look as though nothing is owed".
 *
 * `WAIVED` is deliberately not folded into `VERIFIED`. A waiver is #436's override, granted
 * by a named person for a bounded time, and drawing it as though somebody had checked a
 * document would be the screen telling an operator something that is not true.
 */
export type VerificationStanding =
  | 'NOT_REQUIRED'
  | 'WAIVED'
  | 'VERIFIED'
  | 'NEVER_REQUESTED'
  | 'AWAITING_DOCUMENTS'
  | 'UNDER_REVIEW'
  | 'REJECTED'
  | 'EXPIRED';

/**
 * Where the creator stands with a payout destination — #432.
 *
 * `VerificationStanding`'s companion, one question along: that one is whether the platform
 * has established *who* the creator is, and this is whether it has established *where* their
 * money goes. Two values rather than one merged flag, because the two are chased on different
 * screens by different people.
 *
 * There is no `NOT_REQUIRED`. Sending money to an account nobody confirmed belongs to the
 * recipient is not a policy the platform could adopt at any threshold, so the only exception
 * is `WAIVED` — #436's override, which expires.
 */
export type DestinationStanding =
  | 'WAIVED'
  | 'VERIFIED'
  | 'NONE'
  | 'AWAITING_VERIFICATION'
  | 'NAME_MISMATCH'
  | 'REJECTED';

export interface Payout {
  id: string;
  projectId: string;
  creatorId: string;
  gross: Money;
  platformFee: Money;
  processingFee: Money;
  taxWithheld: Money;
  refunded: Money;
  net: Money;
  /** Which terms produced the deductions, so the arithmetic can be traced back. */
  feeScheduleId?: string | null;
  state: PayoutState;
  payableAt: string;
  /**
   * Whether the hold has expired, computed against the server's clock.
   *
   * Sent rather than derived: a client comparing `payableAt` to its own clock would show a
   * payout as approvable a few seconds early, and the service would then refuse a button
   * that looked enabled.
   */
  payableNow: boolean;
  approvalsRequired: number;
  /** Where the creator stands with identity verification (#431). Read live by the service. */
  creatorStanding: VerificationStanding;
  /**
   * Whether that standing is what is holding this payout.
   *
   * Sent rather than derived from `creatorStanding`, for `payableNow`'s reason: which
   * standings release a payout is a rule, and a second copy of it in the browser is the copy
   * that disagrees the day the rule changes.
   */
  heldForVerification: boolean;
  /** Where the creator stands with a payout destination (#432). Read live by the service. */
  destinationStanding: DestinationStanding;
  /** Whether that standing is what is holding this payout. `heldForVerification`'s reason. */
  heldForDestination: boolean;
  /**
   * How the destination on file is paid — #397. `BANK_TRANSFER` is an IBAN that staff pay by
   * hand from IdeyaNest's account, and `send` refuses it. Absent when nothing is on file.
   */
  destinationKind?: DestinationKind | null;
  /** When somebody started paying it by bank transfer. Set while a transfer is in progress. */
  bankTransferStartedAt?: string | null;
  /** Who started it. */
  bankTransferStartedBy?: string | null;
  /** The value date the bank statement showed, once the transfer is recorded. `YYYY-MM-DD`. */
  bankTransferredOn?: string | null;
  payoutTransactionId?: string | null;
  failureCode?: string | null;
  failureMessage?: string | null;
  calculatedAt: string;
  sentAt?: string | null;
}

export interface PayoutApproval {
  approverId: string;
  approvedAt: string;
  note?: string | null;
}

export interface PayoutFile {
  payout: Payout;
  approvals: PayoutApproval[];
  /** How many more signatures it needs. From the service — see the module comment. */
  stillNeeded: number;
}

export interface PayoutPage {
  payouts: Payout[];
  page: number;
  hasMore: boolean;
}

/**
 * Whether a bank transfer of this payout has been started and not yet recorded — #397, #398.
 *
 * <p>The marker stays on a payout once it is paid, so the state is read beside it. While this
 * holds the money may have left: the service refuses to cancel the payout or take a signature
 * off it.
 */
export function bankTransferInProgress(payout: Payout): boolean {
  return payout.state === 'APPROVED' && payout.bankTransferStartedAt != null;
}

/**
 * The calendar day an instant falls on in Baku, `YYYY-MM-DD` — the day a bank statement is dated
 * in, and the one the service bounds a transfer's value date by (#397).
 *
 * <p>`lib/admin/dashboard.ts` has the same function as `bakuToday`, and importing it from here
 * was measured: sharing that module between the console's front page and this route moved it
 * into a chunk of its own and put `/admin` over its First Load JS budget. Eight lines are cheaper
 * than that chunk.
 */
export function bankDay(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Baku',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/** The queue: everything still on its way, oldest first, holds included. */
export async function readPayoutQueue(page = 0, signal?: AbortSignal): Promise<PayoutPage> {
  const response = await authorizedFetch(`/v1/admin/payouts/queue?page=${page}`, { signal });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as PayoutPage;
}

/** Everything, newest first, optionally narrowed to one state. */
export async function listPayouts(
  state: PayoutState | null,
  page = 0,
  signal?: AbortSignal,
): Promise<PayoutPage> {
  const parameters = new URLSearchParams({ page: String(page) });
  if (state != null) parameters.set('state', state);

  const response = await authorizedFetch(`/v1/admin/payouts?${parameters}`, { signal });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as PayoutPage;
}

/** One payout with its signatures. */
export async function readPayout(payoutId: string, signal?: AbortSignal): Promise<PayoutFile> {
  const response = await authorizedFetch(`/v1/admin/payouts/${encodeURIComponent(payoutId)}`, {
    signal,
  });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as PayoutFile;
}

/** Works out what a campaign owes, and starts the hold. */
export async function calculatePayout(projectId: string, signal?: AbortSignal): Promise<Payout> {
  const response = await authorizedFetch('/v1/admin/payouts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId }),
    signal,
  });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as Payout;
}

/** Signs off. Signing twice is a no-op, not a second signature. */
export async function approvePayout(
  payoutId: string,
  note: string | null,
  signal?: AbortSignal,
): Promise<PayoutFile> {
  const response = await authorizedFetch(
    `/v1/admin/payouts/${encodeURIComponent(payoutId)}/approvals`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note }),
      signal,
    },
  );
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as PayoutFile;
}

/** Takes the caller's own signature back. There is no way to withdraw somebody else's. */
export async function withdrawApproval(
  payoutId: string,
  signal?: AbortSignal,
): Promise<PayoutFile> {
  const response = await authorizedFetch(
    `/v1/admin/payouts/${encodeURIComponent(payoutId)}/approvals`,
    { method: 'DELETE', signal },
  );
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as PayoutFile;
}

/**
 * Instructs the provider.
 *
 * No body, since #432. It used to carry a destination that the operator typed at the moment
 * of sending, which defeated §4.11's dual approval entirely: the two signatures were on an
 * amount and the destination was chosen afterwards by one of the signatories. The service now
 * reads the account the creator filed and a compliance reviewer confirmed, and refuses when
 * there is not one.
 */
export async function sendPayout(payoutId: string, signal?: AbortSignal): Promise<Payout> {
  const response = await authorizedFetch(`/v1/admin/payouts/${encodeURIComponent(payoutId)}/send`, {
    method: 'POST',
    signal,
  });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as Payout;
}

/** Withdraws a payout before it is sent. */
export async function cancelPayout(payoutId: string, signal?: AbortSignal): Promise<Payout> {
  const response = await authorizedFetch(
    `/v1/admin/payouts/${encodeURIComponent(payoutId)}/cancel`,
    { method: 'POST', signal },
  );
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as Payout;
}
