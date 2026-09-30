import type { ReactNode } from 'react';
import {
  createTranslator,
  IntlProvider,
  useTranslations,
  type MessageKeys,
  type NestedKeyOf,
} from 'use-intl';
import az from '@ideanest/messages/az.json';
import en from '@ideanest/messages/en.json';
import ru from '@ideanest/messages/ru.json';
import tr from '@ideanest/messages/tr.json';
import type { Locale } from '@ideanest/messages';
import { dateTimeFormat, numberFormat } from '@ideanest/messages/formats';
import { installHermesFormatting } from '@ideanest/messages/hermes';
import { pluralForm, type PluralForms } from '@ideanest/messages/plurals';
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
/*
 * Hermes has no `DateTimeFormat.prototype.formatToParts` and, on iOS, no `NumberFormat` one,
 * which the shared Azerbaijani formatters read. This swaps in their part-less versions where
 * the engine lacks a method, and does nothing where it has both (jest, Node). Here, at import,
 * because it has to precede the first formatter `@ideanest/messages/formats` builds and caches.
 */
installHermesFormatting();

const CATALOGUES: Record<Locale, typeof en> = { az, en, ru, tr } as Record<Locale, typeof en>;

/**
 * One language's whole catalogue, for a table that reads a namespace as data rather than
 * key by key (`lib/pledge-states.ts`). Typed from the English one, as the translator is.
 */
export function catalogue(locale: Locale): typeof en {
  return CATALOGUES[locale];
}

/**
 * Keys and locales are typed from the English catalogue, so `t('mobile.tabz.me')` is a
 * compile error rather than a key rendered as its own name on a phone. `catalogue.test.ts`
 * keeps the other three on the same key set, so one shape describes all four.
 */
declare module 'use-intl' {
  interface AppConfig {
    Messages: typeof en;
    Locale: Locale;
  }
}

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

/** The whole-catalogue translator, for a helper that is handed one rather than calling `useT`. */
export type Translate = ReturnType<typeof useTranslations<never>>;

/**
 * Any key that names a message — for tables that hold a key and translate it later (the Me
 * hub's rows, a placeholder screen's title), so a typo there fails to compile too.
 */
export type MessageKey = MessageKeys<typeof en, NestedKeyOf<typeof en>>;

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

/*
 * The `Intl` tag for each language is the web's `INTL_LOCALE`, read inside the helpers below
 * rather than here: English is British English on both platforms, so a date reads
 * `30 Sept 2026` rather than `Sep 30, 2026`.
 */

/** Each category named as itself, so the web's `pluralForm` answers with the category. */
const CATEGORIES: PluralForms = { one: 'one', few: 'few', many: 'many', other: 'other' };

/**
 * Which of the catalogue's `{one, few, many, other}` forms a number takes.
 *
 * The web's `pluralForm`, asked with a table whose forms are the category names, so the rule
 * is the one rule and not a copy of it: CLDR through `Intl.PluralRules`, and `other` for a
 * category the catalogue does not carry (`zero`, `two`) — or, here only, an engine without
 * the constructor. ICU `{count, plural, …}` messages do not need this — `t()` plurals them
 * itself.
 */
export function pluralCategory(locale: Locale, count: number): keyof PluralForms {
  try {
    return pluralForm(locale, CATEGORIES, count) as keyof PluralForms;
  } catch {
    return 'other';
  }
}

/**
 * A count grouped the reader's way (`1 234` in Russian, `1.234` in Turkish and Azerbaijani).
 * Not for money.
 *
 * Through the web's `numberFormat`, so Azerbaijani takes the #401/#403 bypass: Hermes on
 * Android formats with the platform's ICU, which may claim `az` and group it the root
 * locale's way. An engine that cannot format at all gets the bare digits.
 */
export function formatCount(count: number, locale: Locale): string {
  try {
    // An empty answer is a formatter that failed without saying so; the digits are better.
    return numberFormat(locale, {}, 'count').format(count) || String(count);
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
 * Through the web's `dateTimeFormat`, so Azerbaijani is written out by
 * `@ideanest/messages/azerbaijani` on every engine rather than trusted to the platform's ICU —
 * `14 avq 2026`, not `2026 M08 14`.
 */
export function formatDate(iso: string | null | undefined, locale: Locale): string {
  if (iso == null || iso === '') return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    // An empty answer is a formatter that failed without saying so; the ISO day is better.
    return dateTimeFormat(locale, { dateStyle: 'medium' }, 'date').format(date) || iso.slice(0, 10);
  } catch {
    return iso.slice(0, 10);
  }
}
