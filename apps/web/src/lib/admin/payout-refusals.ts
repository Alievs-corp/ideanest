import { ApiError } from '../api/problem';
import { fillPlaceholders } from '../i18n/placeholders';
import type { PayoutQueueCopy } from '../i18n/admin/money-copy';
import { bankDay, type Payout } from './payouts';
import type { Locale } from '../i18n/locale';
import { codedRefusalFor } from './coded-refusal';
import { calendarDate } from './console-dates';

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
 * @param locale the reader's language, for the two days a date refusal names; ISO without it
 */
export function payoutRefusalFor(cause: unknown, copy: PayoutQueueCopy, payout?: Payout, locale?: Locale): string {
  if (cause instanceof ApiError) {
    const code = cause.problem?.code;
    const words = copy.refusal;

    if (code === 'PAYOUT_NOT_SENDABLE') {
      return figuresMoved(cause) ? words.FIGURES_MOVED : words.PAYOUT_NOT_SENDABLE;
    }
    if (code === 'BANK_TRANSFER_DATE_OUT_OF_RANGE') {
      const startedAt = payout?.bankTransferStartedAt;
      const day = (value: string) => (locale === undefined ? value : calendarDate(value, locale));
      return fillPlaceholders(words.BANK_TRANSFER_DATE_OUT_OF_RANGE, {
        start: startedAt == null ? '—' : day(bankDay(new Date(startedAt))),
        today: day(bankDay()),
      });
    }
  }
  // Everything else by its code, and never the service's English `detail`: a code with no sentence
  // reads as the console's own refusal, and a request Spring refused before any code ran as one.
  const words: Readonly<Record<string, string>> = { ...copy.refusal, FIGURES_MOVED: copy.refusal.PAYOUT_NOT_SENDABLE };
  return codedRefusalFor(cause, words, copy.refusal.INVALID_REQUEST, copy.payoutSubject, copy.refusals);
}

/**
 * A refusal of "work out what this campaign owes" — its own five codes, which mean something
 * different there than on a payout's file: `CAMPAIGN_ALREADY_PAID_OUT` is the campaign, not this
 * payout, and `PAYOUT_SEND_UNCONFIRMED` is an earlier payout's send.
 */
export function calculateRefusalFor(cause: unknown, copy: PayoutQueueCopy): string {
  return codedRefusalFor(
    cause,
    { ...copy.refusal, ...copy.calculateRefusal },
    copy.refusal.INVALID_REQUEST,
    copy.subject,
    copy.refusals,
  );
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
