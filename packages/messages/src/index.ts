export { SUPPORTED_LOCALES, LOCALE_NAMES, isLocale, type Locale } from './locale';
export { COUNTRY_HEADER, COUNTRY_LOCALES, localeForCountry } from './country';
export * from './whatsapp';
/*
 * The pure formatting helpers, also published one module per subpath
 * (`@ideanest/messages/formats` and so on). The web imports the subpaths, so a client bundle
 * that needs `fillPlaceholders` is handed that module and not the WhatsApp composer beside it;
 * the root re-exports them for a consumer that does not tree-shake anyway (Metro).
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
