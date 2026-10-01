import type { Locale } from '@ideanest/messages';

/**
 * Text in capitals, as the language writes them — the Updates card's eyebrow (#155).
 *
 * <p>Not `textTransform: 'uppercase'`, and not `toLocaleUpperCase(locale)`. Azerbaijani and
 * Turkish have a dotted and a dotless i, and their capitals are İ and I: "Yenilik" is "YENİLİK".
 * iOS's text transform capitalises in the root locale and draws "YENILIK" — a different, wrong
 * word to a reader of either language — and Hermes' `toLocaleUpperCase` is not guaranteed to
 * honour a locale either. So the one letter that differs is mapped before the root-locale
 * `toUpperCase`, which already turns the dotless ı into I.
 */
export function upperCaseIn(text: string, locale: Locale): string {
  const dotted = locale === 'az' || locale === 'tr' ? text.replace(/i/g, 'İ') : text;
  return dotted.toUpperCase();
}
