import { signInHref } from '../auth/redirect';
import { requiresSession } from './private-routes';

export { syncLocale } from '../i18n/sync';

/**
 * What `SessionProvider` does once `GET /v1/me` has answered, loaded only then — issue #216.
 *
 * `SessionProvider` sits in the root layout, so everything it imports statically is in every
 * route's First Load JS, and several routes sit within bytes of their ceilings. Both jobs here
 * wait for the session read anyway: the route guard acts only on a `signed-out` answer, and
 * the language sync (`lib/i18n/sync.ts`) only on an answer at all. Loading them together, in
 * one chunk after the read, is what paid for the language sync without raising a budget: the
 * guard's route list and return-path encoder left the first load as the sync's loader
 * arrived.
 */

/** Where an anonymous reader on `pathname` is sent, or `null` for a public route. */
export function privateRouteRedirect(pathname: string, query: string): string | null {
  return requiresSession(pathname) ? signInHref(`${pathname}${query}`) : null;
}
