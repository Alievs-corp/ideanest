import { regionNames } from '@ideanest/messages/formats';
import type { Locale } from '@ideanest/messages/locale';

export function countryName(code: string, locale: Locale): string {
  try {
    return regionNames(locale)?.of(code) ?? code;
  } catch {
    return code;
  }
}
