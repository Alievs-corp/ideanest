import { numberFormat } from '../i18n/formats';
import type { Locale } from '../i18n/locale';

/**
 * Counts and rates on the console's figure screens, in the reader's language.
 *
 * <p>The front page grouped counts with a comma whatever the language and printed a rate as the
 * service's digits with a `%` after them; the analytics screen printed counts ungrouped and
 * rounded the rate to a whole number. The same figure read differently on two screens one click
 * apart. Both now come through here.
 *
 * <p><strong>Not for money</strong>, which `@ideanest/money` formats from its digits and never
 * through a number.
 */

/** A count, grouped the way the reader's language groups: `1,234`, `1.234`, `1 234`. */
export function formatCount(value: number | string, locale: Locale): string {
  const count = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(count)) return String(value);
  return numberFormat(locale, { maximumFractionDigits: 0 }, 'console-count').format(count);
}

/**
 * A percentage the service sends as a decimal string of per cent — `"66.67"` — to at most two
 * places, in the reader's language: `66.67%`, `66,67%`, `%66,67`.
 */
export function formatPercent(value: string, locale: Locale): string {
  const percent = Number(value);
  if (!Number.isFinite(percent)) return value;
  return formatShare(percent / 100, locale);
}

/** A fraction between nought and one — `0.6667` — as {@link formatPercent} would print it. */
export function formatShare(fraction: number, locale: Locale): string {
  return numberFormat(
    locale,
    { style: 'percent', minimumFractionDigits: 0, maximumFractionDigits: 2 },
    'console-percent',
  ).format(fraction);
}
