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
import {
  formatToPartsWorks,
  partlessAzerbaijaniDateTimeFormat,
  partlessAzerbaijaniNumberFormat,
} from '@ideanest/messages/hermes';
import { pluralForm, type PluralForms } from '@ideanest/messages/plurals';
import { WINDOW_DATE_OPTIONS } from '@ideanest/discovery/collections';
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
/**
 * Hermes has no `DateTimeFormat.prototype.formatToParts` and, on iOS, no `NumberFormat` one,
 * which the shared Azerbaijani formatters read. Asked once, at import: where a method is
 * missing or answers nothing, Azerbaijani goes to `@ideanest/messages/hermes`'s part-less
 * formatter instead, which writes the same strings. The other three languages never read
 * parts, and on Node and in jest both methods work, so nothing changes there.
 */
const PARTS = formatToPartsWorks();
const COUNT_OPTIONS: Intl.NumberFormatOptions = {};
const DATE_OPTIONS: Intl.DateTimeFormatOptions = { dateStyle: 'medium' };
const TIME_OPTIONS: Intl.DateTimeFormatOptions = { timeStyle: 'short' };
const DATE_TIME_OPTIONS: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' };
let partlessCount: ReturnType<typeof partlessAzerbaijaniNumberFormat> | undefined;
let partlessDate: ReturnType<typeof partlessAzerbaijaniDateTimeFormat> | undefined;
let partlessTime: ReturnType<typeof partlessAzerbaijaniDateTimeFormat> | undefined;
let partlessDateTime: ReturnType<typeof partlessAzerbaijaniDateTimeFormat> | undefined;
let partlessWindow: ReturnType<typeof partlessAzerbaijaniDateTimeFormat> | undefined;

function countFormat(locale: Locale): { format(value: number): string } {
  if (locale !== 'az' || PARTS.numbers) return numberFormat(locale, COUNT_OPTIONS, 'count');
  return (partlessCount ??= partlessAzerbaijaniNumberFormat(COUNT_OPTIONS));
}

function dateFormat(locale: Locale): { format(value: Date): string } {
  if (locale !== 'az' || PARTS.dates) return dateTimeFormat(locale, DATE_OPTIONS, 'date');
  return (partlessDate ??= partlessAzerbaijaniDateTimeFormat(DATE_OPTIONS));
}

function timeFormat(locale: Locale): { format(value: Date): string } {
  if (locale !== 'az' || PARTS.dates) return dateTimeFormat(locale, TIME_OPTIONS, 'time');
  return (partlessTime ??= partlessAzerbaijaniDateTimeFormat(TIME_OPTIONS));
}

function dateTimeFormatFor(locale: Locale): { format(value: Date): string } {
  if (locale !== 'az' || PARTS.dates) return dateTimeFormat(locale, DATE_TIME_OPTIONS, 'dateTime');
  return (partlessDateTime ??= partlessAzerbaijaniDateTimeFormat(DATE_TIME_OPTIONS));
}

function windowFormat(locale: Locale): { format(value: Date): string } {
  if (locale !== 'az' || PARTS.dates) return dateTimeFormat(locale, WINDOW_DATE_OPTIONS, 'window');
  return (partlessWindow ??= partlessAzerbaijaniDateTimeFormat(WINDOW_DATE_OPTIONS));
}

export function formatCount(count: number, locale: Locale): string {
  try {
    // An empty answer is a formatter that failed without saying so; the digits are better.
    return countFormat(locale).format(count) || String(count);
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
 * Through the web's `dateTimeFormat` (or, on Hermes, its part-less twin), so Azerbaijani is
 * written out by `@ideanest/messages` on every engine rather than trusted to the platform's
 * ICU — `14 avq 2026`, not `2026 M08 14`.
 */
export function formatDate(iso: string | null | undefined, locale: Locale): string {
  if (iso == null || iso === '') return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    // An empty answer is a formatter that failed without saying so; the ISO day is better.
    return dateFormat(locale).format(date) || iso.slice(0, 10);
  } catch {
    return iso.slice(0, 10);
  }
}

/**
 * One end of a collection's window (#154): a long date in **UTC**, in the reader's language —
 * the web's `formatWindowDate`, so a window closing at 23:30 UTC on the 31st reads "31" on a
 * phone in Baku as it does in a browser anywhere. `null` for a value that is not a date, which
 * `windowFacts` drops rather than printing; the ISO day when the engine cannot format.
 */
export function formatWindowDate(iso: string, locale: Locale): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return windowFormat(locale).format(date) || date.toISOString().slice(0, 10);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/**
 * A clock time from an ISO timestamp (`02:30`), in the reader's language and the phone's time
 * zone — issue #214's maintenance times. The same fallbacks as {@link formatDate}: as it came
 * when it will not parse, the ISO time when the engine cannot format.
 */
export function formatTime(iso: string | null | undefined, locale: Locale): string {
  return formatWith(iso, locale, timeFormat, (value) => value.slice(11, 16));
}

/** A date and a clock time (`5 Oct 2026, 01:00`), as {@link formatTime}. */
export function formatDateTime(iso: string | null | undefined, locale: Locale): string {
  return formatWith(iso, locale, dateTimeFormatFor, (value) => value.slice(0, 16).replace('T', ' '));
}

function formatWith(
  iso: string | null | undefined,
  locale: Locale,
  formatter: (locale: Locale) => { format(value: Date): string },
  bare: (iso: string) => string,
): string {
  if (iso == null || iso === '') return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return formatter(locale).format(date) || bare(iso);
  } catch {
    return bare(iso);
  }
}

/*
 * The campaign page's two dates (#155) — the web's `formatInstant` and `formatDay`
 * (`apps/web/src/lib/projects/deadline.ts`), with the same fields, so a deadline reads the same
 * in a browser and on a phone in the same zone.
 *
 * The web formats twice — UTC on the server, the reader's zone once hydrated (`ViewerInstant`).
 * The app has no server render to match, so it writes the device's zone from the first frame.
 */
const UNZONED_INSTANT_OPTIONS: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
};
const INSTANT_OPTIONS: Intl.DateTimeFormatOptions = {
  ...UNZONED_INSTANT_OPTIONS,
  timeZoneName: 'short',
};
const DAY_OPTIONS: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' };
let partlessInstant: ReturnType<typeof partlessAzerbaijaniDateTimeFormat> | undefined;
const partlessDays = new Map<string, ReturnType<typeof partlessAzerbaijaniDateTimeFormat>>();

/**
 * The device zone's short name as CLDR writes a zone without an abbreviation — `GMT+4`,
 * `GMT+5:30`, `GMT` — which is what the shared Azerbaijani formatter prints for Baku. Computed
 * from the offset because the part-less path below cannot read a zone name out of `format()`.
 */
function gmtLabel(at: Date): string {
  const offset = -at.getTimezoneOffset();
  if (offset === 0) return 'GMT';
  const hours = Math.floor(Math.abs(offset) / 60);
  const minutes = Math.abs(offset) % 60;
  return `GMT${offset < 0 ? '-' : '+'}${hours}${minutes === 0 ? '' : `:${twoDigits(minutes)}`}`;
}

function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * An instant a reader may have to act before — a campaign's deadline — as day, month, year,
 * hour and minute **in the device's time zone, with the zone named** (`3 October 2026, 18:00 GMT+4`).
 *
 * <p>`null` for a value that is not an instant, so the caller draws nothing rather than "Invalid
 * Date" (the web's rule). On Hermes, whose `DateTimeFormat` has no `formatToParts`, Azerbaijani
 * takes the part-less formatter without the zone name — it cannot reproduce one — and the zone is
 * appended as the shared formatter would write it.
 */
export function formatInstant(iso: string | null | undefined, locale: Locale): string | null {
  if (iso == null || iso === '') return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  try {
    if (locale === 'az' && !PARTS.dates) {
      /*
       * `hour: '2-digit'` here only. The shared formatter on an engine with parts writes the
       * hour as `en-GB` does, padded (`09:06`); the part-less one leaves `hour: 'numeric'` beside
       * minutes unpadded (`9:06`). Asking it for two digits is what makes the two engines print
       * the same deadline.
       */
      partlessInstant ??= partlessAzerbaijaniDateTimeFormat({
        ...UNZONED_INSTANT_OPTIONS,
        hour: '2-digit',
      });
      return `${partlessInstant.format(date)} ${gmtLabel(date)}`;
    }
    return dateTimeFormat(locale, INSTANT_OPTIONS, 'campaignInstant').format(date) || null;
  } catch {
    return null;
  }
}

/** The zone the web's server renders in (`SERVER_TIME_ZONE` in `apps/web/src/lib/projects/deadline.ts`). */
export const SERVER_TIME_ZONE = 'UTC';
let partlessUtcInstant: ReturnType<typeof partlessAzerbaijaniDateTimeFormat> | undefined;

/**
 * An instant written in UTC with the zone named — the web's `formatInstant(instant,
 * SERVER_TIME_ZONE, locale)`, for dates the web prints from the server, such as the day a legal
 * document came into force (#164). The phone prints the same string as the browser whatever the
 * device's zone. `null` for a value that is not an instant.
 */
export function formatServerInstant(iso: string | null | undefined, locale: Locale): string | null {
  if (iso == null || iso === '') return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  try {
    if (locale === 'az' && !PARTS.dates) {
      partlessUtcInstant ??= partlessAzerbaijaniDateTimeFormat({
        ...UNZONED_INSTANT_OPTIONS,
        hour: '2-digit',
        timeZone: SERVER_TIME_ZONE,
      });
      return `${partlessUtcInstant.format(date)} ${SERVER_TIME_ZONE}`;
    }
    return (
      dateTimeFormat(locale, { ...INSTANT_OPTIONS, timeZone: SERVER_TIME_ZONE }, 'serverInstant').format(date) ||
      null
    );
  } catch {
    return null;
  }
}

/**
 * A calendar day (`3 October 2026`) — the web's `formatDay`. In the device's zone by default;
 * `timeZone: 'UTC'` where the web deliberately prints the UTC day (the update obligation's dates,
 * the day a campaign closed), so a phone and a browser name the same day. `null` for a value that
 * is not an instant.
 */
export function formatDay(
  iso: string | null | undefined,
  locale: Locale,
  timeZone?: string,
): string | null {
  if (iso == null || iso === '') return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const options = timeZone === undefined ? DAY_OPTIONS : { ...DAY_OPTIONS, timeZone };
  const key = `campaignDay:${timeZone ?? ''}`;
  try {
    if (locale === 'az' && !PARTS.dates) {
      let formatter = partlessDays.get(key);
      if (formatter === undefined) {
        formatter = partlessAzerbaijaniDateTimeFormat(options);
        partlessDays.set(key, formatter);
      }
      return formatter.format(date) || null;
    }
    return dateTimeFormat(locale, options, key).format(date) || null;
  } catch {
    return null;
  }
}
