import { createApiClient, type ApiClient, type Fetch } from '@ideanest/api-client';
import { apiOrigin } from './config';
import { currentLocale } from '../lib/locale';
import { refreshAccessToken } from '../lib/auth';
import { observeResponse } from '../lib/maintenance';
import { currentAccessToken, hasStoredSession } from '../lib/session';

/**
 * The service, as this application talks to it.
 *
 * <h2>Absolute URLs, unlike the web client</h2>
 *
 * `apps/web` calls `/v1` as a relative path so that the browser treats it as
 * same-origin and attaches a `SameSite=Strict` cookie. There is no document
 * here, no origin, and no rewrite, so every request goes straight to the origin
 * the build was given. That also means there is no cookie: the session is a
 * bearer token from the keychain, which is what `lib/session.ts` exists for.
 *
 * <h2>Why the client is built per request rather than once</h2>
 *
 * `createApiClient` takes its headers at construction, and two of ours change:
 * the access token when a refresh lands, and the language when somebody changes
 * the phone's. A module-level singleton would capture whatever was true at first
 * import — which, for the language, is before the first screen has rendered.
 * Constructing one is an object literal and a closure; it is not worth caching
 * something that would be wrong.
 *
 * <h2>§17.1: the session lives in the `fetch`, not in the headers</h2>
 *
 * The access token is set on the request by {@link sessionFetch} rather than
 * passed to `createApiClient`, and that is the difference between a client that
 * works for fifteen minutes and one that works. A header fixed at construction
 * is a header fixed *before* the refresh that a 401 triggers, so a retry would
 * present the token that had just been refused. Reading it inside the fetch
 * means the retry carries the token the refresh produced.
 *
 * <p>It also puts the whole of the session's request behaviour in one place: a
 * cold start with no token in memory refreshes *before* the first call rather
 * than spending a guaranteed 401 to discover it, and a 401 refreshes and retries
 * exactly once. `@ideanest/api-client` stays what it says it is — headers in,
 * bodies out — and this is the seam it left open.
 */

/**
 * `fetch`, with the session on it.
 *
 * <h2>One retry, never two</h2>
 *
 * A second 401 after a successful refresh is a **refusal**, not an expiry: the
 * token was minted moments ago, so the service is saying this account may not
 * have that resource. Retrying again would be a loop against an answer that will
 * not change, and the caller gets the 401 to render. `apps/web`'s
 * `authorizedFetch` draws the line in the same place and for the same reason.
 */
const sessionFetch: Fetch = async (url, init) => {
  let token = currentAccessToken();

  /*
   * A cold start has a keychain and no access token. Refreshing here rather than
   * after the inevitable 401 saves a round trip on the first screen somebody
   * sees, and — with the lock (MB-03) on — means the biometric prompt appears once, at
   * the moment the first private read is made, rather than after a failure.
   */
  if (token === null && hasStoredSession()) {
    token = await refreshAccessToken();
  }

  /*
   * Every response is shown to the maintenance trigger (issue #150) on its way
   * past, and passed on untouched: a 503 is still a 503 to the caller. It is
   * here rather than in each screen because this is the one place every read
   * and every write goes through.
   */
  const response = observeResponse(await fetch(url, withBearer(init, token)));
  if (response.status !== 401 || !hasStoredSession()) return response;

  const refreshed = await refreshAccessToken();
  if (refreshed === null) return response;

  return observeResponse(await fetch(url, withBearer(init, refreshed)));
};

function withBearer(init: RequestInit | undefined, token: string | null): RequestInit {
  const headers = new Headers(init?.headers);
  if (token === null) {
    /*
     * Deleted rather than left alone. `init` is reused across the retry, and a
     * stale `Authorization` on a request made after the session ended would be a
     * dead credential sent to the service on every subsequent call.
     */
    headers.delete('Authorization');
  } else {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return { ...init, headers };
}

export function api(): ApiClient {
  return createApiClient({
    baseUrl: apiOrigin(),
    headers: { 'Accept-Language': currentLocale() },
    fetch: sessionFetch,
  });
}

/**
 * Tells the service which language the signed-in reader chose — `PATCH /v1/me/locale`.
 *
 * Returns whether the account now agrees. The caller keeps the local choice either way and
 * says so when this is false: a phone that switched language must not switch back because
 * the network dropped. Never called while signed out (the screen checks), because a
 * request without a session can only be a 401.
 */
export async function saveAccountLocale(locale: string): Promise<boolean> {
  try {
    const response = await sessionFetch(`${apiOrigin()}/v1/me/locale`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Accept-Language': currentLocale() },
      body: JSON.stringify({ locale }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
