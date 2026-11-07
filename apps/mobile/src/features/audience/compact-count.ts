import { INTL_LOCALE } from '@ideanest/messages/formats';
import type { Locale } from '@ideanest/messages/locale';
import { formatCount } from '../../lib/i18n';

/**
 * A count for a small chip: "980", "1,2K", "15,3 тыс.", "1.3m" — the web's
 * `Intl.NumberFormat(locale, { notation: 'compact' })`, which the card's eye chip uses there.
 *
 * <p>Hermes is trusted only as far as it is tested. An engine that ignores `notation` writes the
 * whole number ("1,500"), which is still true, so a formatter whose answer for a canary has no
 * letter in it is not used, and the full grouped count is shown instead. Below a thousand there is
 * nothing to shorten and the ordinary count is used.
 */
const COMPACT = new Map<Locale, Intl.NumberFormat | null>();

function compactFormat(locale: Locale): Intl.NumberFormat | null {
  if (COMPACT.has(locale)) return COMPACT.get(locale) ?? null;
  let format: Intl.NumberFormat | null = null;
  try {
    const candidate = new Intl.NumberFormat(INTL_LOCALE[locale], { notation: 'compact', maximumFractionDigits: 1 });
    // Anything beside digits, spaces and separators: a "K", a "тыс.", a "B".
    if (/[^\d\s.,'  ]/.test(candidate.format(1500))) format = candidate;
  } catch {
    format = null;
  }
  COMPACT.set(locale, format);
  return format;
}

export function compactCount(count: number, locale: Locale): string {
  const value = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  if (value < 1000) return formatCount(value, locale);
  try {
    return compactFormat(locale)?.format(value) || formatCount(value, locale);
  } catch {
    return formatCount(value, locale);
  }
}
