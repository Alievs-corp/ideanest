import { UNKNOWN_TIME, dateTimeFormat } from '../i18n/formats';
import type { Locale } from '../i18n/locale';

/**
 * Dates on the console's money screens, in the reader's language and in Baku's calendar.
 *
 * <p>These screens printed `iso.slice(0, 10)`: the UTC day in ISO order, so a payout calculated at
 * 01:30 in Baku read as the day before, in a format nobody in the office writes. `lib/time.ts` formats
 * in the device's zone, which is right for a feed and wrong here: a hold that ends "on the 14th" has
 * to be the 14th in Baku for everybody reading it, because that is the day the bank statement and the
 * service's own date checks use.
 */

const BAKU = 'Asia/Baku';

/** The day an instant falls on in Baku: `14 Oct 2026`, `14 okt 2026`. */
export function bakuDate(iso: string, locale: Locale): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return UNKNOWN_TIME[locale];

  return dateTimeFormat(locale, { dateStyle: 'medium', timeZone: BAKU }, 'baku-date').format(at);
}

/** The day and the time in Baku, for a moment somebody acted: a signature, an unanswered send. */
export function bakuDateTime(iso: string, locale: Locale): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return UNKNOWN_TIME[locale];

  return dateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: BAKU }, 'baku-date-time').format(at);
}

/**
 * A calendar day the service sends as `YYYY-MM-DD` — a bank's value date, not an instant.
 *
 * <p>Read at noon UTC and formatted in UTC, so no zone can move it to the day before or after.
 */
export function calendarDate(day: string, locale: Locale): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;

  const at = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(at.getTime())) return day;

  return dateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }, 'calendar-date').format(at);
}
