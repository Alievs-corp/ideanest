import Decimal from 'decimal.js';
import { regionNames } from '@ideanest/messages/formats';
import type { Locale } from '@ideanest/messages/locale';

export function countryName(code: string, locale: Locale): string {
  try {
    return regionNames(locale)?.of(code) ?? code;
  } catch {
    return code;
  }
}

/** A fee fraction ("0.025") as a percentage in the reader's language, from strings only. */
export function percentOf(fraction: string, locale: Locale): string {
  let digits: string;
  try {
    digits = new Decimal(fraction).times(100).toDecimalPlaces(2).toString();
  } catch {
    return fraction;
  }
  const local = locale === 'en' ? digits : digits.replace('.', ',');
  return locale === 'tr' ? `%${local}` : `${local}%`;
}
