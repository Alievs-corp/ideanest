import { DELIVERY_MONTH_OPTIONS } from '@ideanest/campaign/reward-details';
import { dateTimeFormat } from './formats';
import type { Locale } from './locale';

/**
 * `2026-11-01` as `November 2026` — a reward's estimated delivery, on the campaign page's
 * reward card and in the checkout (#255).
 *
 * A month, because a month is what a creator can honestly promise — the same reasoning the
 * reward editor states about the field. The date is read in UTC: the service stores a plain
 * date, and rendering it in the reader's zone would move a first-of-the-month delivery into the
 * month before it. `DELIVERY_MONTH_OPTIONS` is shared with the app, which formats the same way.
 */
export function deliveryMonth(date: string, locale: Locale): string | null {
  const parsed = Date.parse(date);
  if (!Number.isFinite(parsed)) return null;

  return dateTimeFormat(locale, DELIVERY_MONTH_OPTIONS, 'delivery-month').format(new Date(parsed));
}
