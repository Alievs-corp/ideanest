export { SUPPORTED_LOCALES, LOCALE_NAMES, isLocale, type Locale } from './locale';
export { COUNTRY_HEADER, COUNTRY_LOCALES, localeForCountry } from './country';
export * from './whatsapp';
/*
 * The pure formatting helpers, also published one module per subpath
 * (`@ideanest/messages/formats` and so on). The web's `lib/i18n/{plurals,placeholders,formats}.ts`
 * re-export them from the subpaths, and so does the app's `lib/i18n.tsx`, so neither depends on
 * the bundler dropping the rest of this file. Other web modules import the root for the locale
 * vocabulary, and `sideEffects: false` is what keeps these out of a bundle that does not use them.
 */
export { pluralForm, pluralise, type PluralForms } from './plurals';
export { fillPlaceholders, fillNodes } from './placeholders';
export {
  INTL_LOCALE,
  UNKNOWN_TIME,
  UNDATED,
  capitalised,
  dateTimeFormat,
  relativeTimeFormat,
  numberFormat,
  regionNames,
} from './formats';
export type {
  AzerbaijaniDateTimeFormat,
  AzerbaijaniNumberFormat,
  AzerbaijaniRelativeTimeFormat,
} from './azerbaijani';
