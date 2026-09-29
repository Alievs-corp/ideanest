/**
 * The language vocabulary shared by the web and the mobile application — issue #150,
 * docs/architecture.md §21.1.
 *
 * The four tags are BCP 47 primary subtags, in §21.1's order (the order the preference
 * screen lists them in, so it is data rather than presentation). `apps/web` re-exports
 * these from `lib/i18n/locale.ts`, which keeps its cookie and default-locale decisions.
 */
export const SUPPORTED_LOCALES = ['az', 'en', 'ru', 'tr'] as const;

/** One of §21.1's languages. Anything else is not a locale this platform has. */
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** Each language named in itself: a reader who cannot read the current one must still find theirs. */
export const LOCALE_NAMES: Record<Locale, string> = {
  az: 'Azərbaycan dili',
  en: 'English',
  ru: 'Русский',
  tr: 'Türkçe',
};

/** Whether a value is one of §21.1's languages. The type guard every boundary uses. */
export function isLocale(value: string | null | undefined): value is Locale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}
