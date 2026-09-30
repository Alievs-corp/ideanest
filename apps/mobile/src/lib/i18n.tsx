import type { ReactNode } from 'react';
import { createTranslator, IntlProvider, useTranslations } from 'use-intl';
import az from '@ideanest/messages/az.json';
import en from '@ideanest/messages/en.json';
import ru from '@ideanest/messages/ru.json';
import tr from '@ideanest/messages/tr.json';
import type { Locale } from '@ideanest/messages';
import { currentLocale, useLocale } from './locale';

/**
 * Every word on every screen comes through here — issue #150.
 *
 * `use-intl` is the framework-agnostic core `next-intl` is built on, at the version the web
 * resolves, so a key and its arguments mean the same on both platforms (`t()`, `t.rich()`,
 * namespaces, ICU plurals). The catalogues are the web's own, from `@ideanest/messages`;
 * only the `mobile` namespace is the app's.
 *
 * All four are bundled (Metro cannot load a JSON lazily) and the active one is chosen by
 * `lib/locale.ts`, so changing the language re-renders the tree with no restart. Whether a
 * build step should strip the web-only `admin` namespace is the release-readiness issue's.
 */
const CATALOGUES: Record<Locale, typeof en> = { az, en, ru, tr } as Record<Locale, typeof en>;

/** A missing key renders its own name rather than taking a screen down, as on the web. */
function fallback({ key, namespace }: { key: string; namespace?: string }): string {
  return namespace === undefined ? key : `${namespace}.${key}`;
}

export function AppIntlProvider({ children }: { readonly children: ReactNode }) {
  const locale = useLocale();
  return (
    <IntlProvider
      locale={locale}
      messages={CATALOGUES[locale]}
      getMessageFallback={fallback}
      onError={() => {}}
    >
      {children}
    </IntlProvider>
  );
}

/** The translator for a namespace, or for the whole catalogue with no argument. */
export const useT = useTranslations;

/**
 * The translator for code that runs outside the tree — a system prompt, a keychain read —
 * in the language in use at the moment of the call. A component uses `useT()` instead, so
 * it re-renders when the language changes.
 */
export function translate() {
  const locale = currentLocale();
  return createTranslator({
    locale,
    messages: CATALOGUES[locale],
    getMessageFallback: fallback,
    onError: () => {},
  });
}

/**
 * The `Intl` tag for each language, the web's own table (`lib/i18n/formats.ts`): English is
 * British English on both platforms, so a date reads `30 Sept 2026` rather than `Sep 30, 2026`.
 */
export const INTL_LOCALE: Readonly<Record<Locale, string>> = {
  az: 'az',
  en: 'en-GB',
  ru: 'ru',
  tr: 'tr',
};

/**
 * Which of the catalogue's `{one, few, many, other}` forms a number takes.
 *
 * The same rule as the web's `pluralForm`: CLDR through `Intl.PluralRules`, and `other` for a
 * category the catalogue does not carry (`zero`, `two`) or an engine without the constructor.
 * ICU `{count, plural, …}` messages do not need this — `t()` plurals them itself.
 */
export function pluralCategory(locale: Locale, count: number): 'one' | 'few' | 'many' | 'other' {
  if (typeof Intl.PluralRules !== 'function') return 'other';
  const category = new Intl.PluralRules(INTL_LOCALE[locale]).select(count);
  return category === 'one' || category === 'few' || category === 'many' ? category : 'other';
}

/** A count grouped the reader's way (`1 234` in Russian, `1.234` in Turkish). Not for money. */
export function formatCount(count: number, locale: Locale): string {
  try {
    return new Intl.NumberFormat(INTL_LOCALE[locale]).format(count);
  } catch {
    return String(count);
  }
}

/**
 * A calendar date from an ISO timestamp, in the reader's language.
 *
 * An unparseable value is shown as it came rather than as `Invalid Date`, and an engine with
 * no data for the locale falls back to the ISO day — never to an English month name.
 * Money is not formatted here: `@ideanest/money` formats amounts from their digits, the same
 * on both platforms and in every language.
 *
 * Azerbaijani goes to `Intl` as it is. The web's bypass for engines that claim `az` but format
 * it from root data (`lib/i18n/azerbaijani.ts`) arrives with `formats.ts` in the shared
 * package, and this and `formatCount` switch to it then.
 */
export function formatDate(iso: string | null | undefined, locale: Locale): string {
  if (iso == null || iso === '') return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat(INTL_LOCALE[locale], { dateStyle: 'medium' }).format(date);
  } catch {
    return iso.slice(0, 10);
  }
}
