import type { Locale } from './locale';

/**
 * Which language a first visit from a given country starts in — issue #125.
 *
 * <h2>Why a country and not `Accept-Language`</h2>
 *
 * `routing.ts` turned next-intl's header negotiation off, and the reason still holds: a
 * response that varies by `Accept-Language` splits the shared cache per browser
 * configuration. The country is read only where nothing is cached anyway — the `307` on a
 * path with no language in it — so the localised pages it sends people to stay one cached
 * document each.
 *
 * <h2>Where the country comes from</h2>
 *
 * Cloudflare, which proxies `ideyanest.com`, adds `CF-IPCountry` to every request it
 * forwards: an ISO 3166-1 alpha-2 code, `XX` when it does not know, `T1` for Tor. Nothing
 * here looks the address up itself, so a request that did not come through Cloudflare —
 * local development, a health probe — simply has no country and gets the default.
 *
 * A client can send the header itself. That is harmless by construction: the only thing it
 * decides is which language that same client is redirected to.
 */
export const COUNTRY_HEADER = 'cf-ipcountry';

/**
 * The countries whose first visit is not in the default language.
 *
 * Russian for the members of the CIS, Turkmenistan included as an associate. Georgia and
 * Ukraine left it and are deliberately absent: a Russian front door is not a neutral
 * default there, and English is.
 *
 * Every country not listed here gets `DEFAULT_LOCALE`, which is why this is a table of
 * exceptions rather than a table of every country.
 */
export const COUNTRY_LOCALES: Readonly<Record<string, Locale>> = {
  AZ: 'az',
  TR: 'tr',
  RU: 'ru',
  BY: 'ru',
  KZ: 'ru',
  KG: 'ru',
  UZ: 'ru',
  TJ: 'ru',
  AM: 'ru',
  MD: 'ru',
  TM: 'ru',
};

/**
 * The language a visitor from `country` starts in, or `null` when the country says nothing —
 * missing, unknown to Cloudflare, or simply not in {@link COUNTRY_LOCALES}.
 *
 * `null` rather than the default so the caller decides what comes next; the proxy falls
 * through to `DEFAULT_LOCALE`.
 *
 * Upper-cased before the lookup, which also means no value can reach an inherited property
 * of the table: every one of those is spelled in lower or camel case.
 */
export function localeForCountry(country: string | null | undefined): Locale | null {
  if (typeof country !== 'string') return null;
  return COUNTRY_LOCALES[country.trim().toUpperCase()] ?? null;
}

/**
 * Every ISO 3166-1 alpha-2 code, the vocabulary of a campaign's countries and of a shipping
 * address. The service checks the same list (`Locale.getISOCountries`), and the names come from
 * `Intl.DisplayNames` in the reader's language rather than from a table here.
 */
export const COUNTRY_CODES: readonly string[] = [] = [
  'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AQ', 'AR', 'AS', 'AT', 'AU', 'AW', 'AX', 'AZ', 'BA', 'BB',
  'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ', 'BL', 'BM', 'BN', 'BO', 'BQ', 'BR', 'BS', 'BT', 'BV', 'BW', 'BY',
  'BZ', 'CA', 'CC', 'CD', 'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN', 'CO', 'CR', 'CU', 'CV', 'CW', 'CX',
  'CY', 'CZ', 'DE', 'DJ', 'DK', 'DM', 'DO', 'DZ', 'EC', 'EE', 'EG', 'EH', 'ER', 'ES', 'ET', 'FI', 'FJ', 'FK',
  'FM', 'FO', 'FR', 'GA', 'GB', 'GD', 'GE', 'GF', 'GG', 'GH', 'GI', 'GL', 'GM', 'GN', 'GP', 'GQ', 'GR', 'GS',
  'GT', 'GU', 'GW', 'GY', 'HK', 'HM', 'HN', 'HR', 'HT', 'HU', 'ID', 'IE', 'IL', 'IM', 'IN', 'IO', 'IQ', 'IR',
  'IS', 'IT', 'JE', 'JM', 'JO', 'JP', 'KE', 'KG', 'KH', 'KI', 'KM', 'KN', 'KP', 'KR', 'KW', 'KY', 'KZ', 'LA',
  'LB', 'LC', 'LI', 'LK', 'LR', 'LS', 'LT', 'LU', 'LV', 'LY', 'MA', 'MC', 'MD', 'ME', 'MF', 'MG', 'MH', 'MK',
  'ML', 'MM', 'MN', 'MO', 'MP', 'MQ', 'MR', 'MS', 'MT', 'MU', 'MV', 'MW', 'MX', 'MY', 'MZ', 'NA', 'NC', 'NE',
  'NF', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NU', 'NZ', 'OM', 'PA', 'PE', 'PF', 'PG', 'PH', 'PK', 'PL', 'PM',
  'PN', 'PR', 'PS', 'PT', 'PW', 'PY', 'QA', 'RE', 'RO', 'RS', 'RU', 'RW', 'SA', 'SB', 'SC', 'SD', 'SE', 'SG',
  'SH', 'SI', 'SJ', 'SK', 'SL', 'SM', 'SN', 'SO', 'SR', 'SS', 'ST', 'SV', 'SX', 'SY', 'SZ', 'TC', 'TD', 'TF',
  'TG', 'TH', 'TJ', 'TK', 'TL', 'TM', 'TN', 'TO', 'TR', 'TT', 'TV', 'TW', 'TZ', 'UA', 'UG', 'UM', 'US', 'UY',
  'UZ', 'VA', 'VC', 'VE', 'VG', 'VI', 'VN', 'VU', 'WF', 'WS', 'YE', 'YT', 'ZA', 'ZM', 'ZW',
];
