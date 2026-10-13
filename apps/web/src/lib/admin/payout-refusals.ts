import { ApiError } from '../api/problem';
import { fillPlaceholders } from '../i18n/placeholders';
import type { PayoutQueueCopy } from '../i18n/admin/money-copy';
import { bankDay, type Payout } from './payouts';
import { consoleMessageFor } from './refusals';

/**
 * A refusal from the payout file, in words that say what to do next — issue #398.
 *
 * <p>Branches on the code, never on prose, for `refusals.ts`'s reason, and is checked before the
 * shared table because `SELF_PAID_PAYOUT` is a 403 that names no capability, which the shared
 * table would read as "you are not staff". `PAYOUT_NOT_SENDABLE` is two sentences: with the
 * payout already cancelled it means the figures moved and a new one has to be worked out.
 *
 * <p>Its own module rather than part of the bank-transfer panel, because the file's Send,
 * Cancel and signature controls meet the same refusals and the panel is loaded only when a
 * file needs it.
 *
 * @param payout the payout the refusal is about, for the start day a date refusal names
 */
export function payoutRefusalFor(cause: unknown, copy: PayoutQueueCopy, payout?: Payout): string {
  if (cause instanceof ApiError) {
    const code = cause.problem?.code;
    const words = copy.refusal;

    if (code === 'PAYOUT_NOT_SENDABLE') {
      return figuresMoved(cause) ? words.FIGURES_MOVED : words.PAYOUT_NOT_SENDABLE;
    }
    if (code === 'BANK_TRANSFER_DATE_OUT_OF_RANGE') {
      const startedAt = payout?.bankTransferStartedAt;
      return fillPlaceholders(words.BANK_TRANSFER_DATE_OUT_OF_RANGE, {
        start: startedAt == null ? '—' : bankDay(new Date(startedAt)),
        today: bankDay(),
      });
    }
    if (code !== undefined && code !== 'FIGURES_MOVED' && Object.hasOwn(words, code)) {
      return words[code as keyof typeof words];
    }
  }
  return consoleMessageFor(cause, copy.payoutSubject, copy.refusals);
}

/**
 * Whether a send or a start was refused because the figures moved — #413, #419. The service has
 * cancelled the payout by then (#421), so whatever the screen holds of it is out of date.
 */
export function figuresMoved(cause: unknown): boolean {
  return (
    cause instanceof ApiError &&
    cause.problem?.code === 'PAYOUT_NOT_SENDABLE' &&
    cause.problem.meta?.state === 'CANCELLED'
  );
}
