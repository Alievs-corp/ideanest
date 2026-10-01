import Constants from 'expo-constants';

/**
 * What the application was built pointing at, read back at run time.
 *
 * `app.config.ts` resolves the two origins from the environment at build time
 * and puts them in `extra`; this is the only module that reads them out again,
 * so a screen that needs the site URL asks here rather than reaching into
 * `Constants` and getting `undefined` on the one build where the variable was
 * missing.
 */

interface Extra {
  readonly apiOrigin?: string;
  readonly siteUrl?: string;
  readonly googleIosClientId?: string;
  readonly appleSignIn?: boolean;
}

function extra(): Extra {
  return (Constants.expoConfig?.extra ?? {}) as Extra;
}

/**
 * Where the service is.
 *
 * Throws rather than defaulting. A mobile build with no API origin cannot do
 * anything at all, and the failure is far more legible here — at the first
 * request, naming the missing key — than as a stream of `fetch` errors against
 * `undefined/v1/discover`.
 */
export function apiOrigin(): string {
  const origin = extra().apiOrigin;
  if (origin === undefined || origin === '') {
    throw new Error('This build has no apiOrigin. Set IDEANEST_API_ORIGIN and rebuild.');
  }
  return origin;
}

/** The public origin whose links this application claims — used by the deep links (§4.12 MB-02). */
export function siteUrl(): string {
  const url = extra().siteUrl;
  if (url === undefined || url === '') {
    throw new Error('This build has no siteUrl. Set IDEANEST_SITE_URL and rebuild.');
  }
  return url;
}
export {
  SUPPORTED_LOCALES,
  isLocale as isSupportedLocale,
  type Locale as SupportedLocale,
} from '@ideanest/messages';

/**
 * The app's default language, when nothing else decides — issue #150. Azerbaijani, the
 * platform's primary language; the web's own default stays `en`. Which language is
 * actually in use is `lib/locale.ts`'s question (stored choice, account, device).
 */
export const DEFAULT_LOCALE = 'az' as const;

/** The provider sign-ins this build was configured with (issue #152); see `app.config.ts`. */
export interface ProviderSettings {
  /** Google's iOS OAuth client, or `''` when this build has none. */
  readonly googleIosClientId: string;
  /** Whether this build carries the Sign in with Apple entitlement. */
  readonly appleSignIn: boolean;
}

export function providerSettings(): ProviderSettings {
  const { googleIosClientId, appleSignIn } = extra();
  return {
    googleIosClientId: typeof googleIosClientId === 'string' ? googleIosClientId.trim() : '',
    appleSignIn: appleSignIn === true,
  };
}
