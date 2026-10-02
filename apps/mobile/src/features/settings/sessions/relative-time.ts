import type { Locale } from '@ideanest/messages';
import { UNKNOWN_TIME, relativeTimeFormat } from '@ideanest/messages/formats';
import { formatDateTime } from '../../../lib/i18n';

const DIVISIONS: ReadonlyArray<readonly [amount: number, unit: Intl.RelativeTimeFormatUnit]> = [
  [60, 'second'],
  [60, 'minute'],
  [24, 'hour'],
  [7, 'day'],
  [4.34524, 'week'],
  [12, 'month'],
  [Number.POSITIVE_INFINITY, 'year'],
];

/**
 * "3 hours ago" for a device row — the web's `formatRelativeTime` (`apps/web/src/lib/time.ts`),
 * same steps and same formatter.
 *
 * <p>One difference: Hermes may have no `Intl.RelativeTimeFormat`. Constructing one there throws,
 * and then the row says the exact date and time instead — less friendly, never wrong. Azerbaijani
 * does not depend on it (`@ideanest/messages` writes those words itself).
 */
export function relativeTime(iso: string, now: Date, locale: Locale): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return UNKNOWN_TIME[locale];

  try {
    const relative = relativeTimeFormat(locale, { numeric: 'auto' }, 'relative');
    let duration = (then.getTime() - now.getTime()) / 1000;
    // Under a minute a rounded figure is noise; `format(0, 'second')` is the language's "now".
    if (Math.abs(duration) < 45) return relative.format(0, 'second') || formatDateTime(iso, locale);

    for (const [amount, unit] of DIVISIONS) {
      if (Math.abs(duration) < amount) {
        return relative.format(Math.round(duration), unit) || formatDateTime(iso, locale);
      }
      duration /= amount;
    }
    return relative.format(Math.round(duration), 'year') || formatDateTime(iso, locale);
  } catch {
    return formatDateTime(iso, locale);
  }
}
