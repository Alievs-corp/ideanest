import {
  ApiError,
  createApiClient,
  errorFrom,
  type ApiClient,
  type Fetch,
} from '@ideanest/api-client';
import { traceIdOf } from '@ideanest/api-client/trace';
import { apiOrigin } from './config';
import { rememberTrace } from './last-trace';
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
   * sees. It never shows a prompt: the token is an ordinary keychain item, and the app
   * lock is a gate in front of the interface (`lib/app-lock.ts`, #319).
   */
  if (token === null && hasStoredSession()) {
    token = await refreshAccessToken();
  }

  /*
   * Every response is shown to the maintenance trigger (issues #150, #214) on
   * its way past, and passed on untouched: a 503 is still a 503 to the caller,
   * and only the maintenance problem opens the screen. It is here rather than
   * in each screen because this is the one place every read and every write
   * goes through. Its trace id is kept for crash reports for the same reason (`last-trace.ts`).
   */
  const response = rememberTrace(await observeResponse(await fetch(url, withBearer(init, token))));
  if (response.status !== 401 || !hasStoredSession()) return response;

  const refreshed = await refreshAccessToken();
  if (refreshed === null) return response;

  return rememberTrace(await observeResponse(await fetch(url, withBearer(init, refreshed))));
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

/**
 * The `X-Trace-Id` each refusal came back with, keyed by the error — issue #150.
 *
 * `ApiError` is `@ideanest/api-client`'s and deliberately has no field for it: the web's route
 * bundles carry that class and are budgeted to the tenth of a KiB, and the web does not print
 * trace ids from it. So the app keeps the id beside the error rather than on it. A `WeakMap`,
 * so an error nobody holds any more takes its entry with it.
 */
const TRACES = new WeakMap<object, string>();

/** The trace id of a failed read made through {@link api}, or null (`route-error-boundary.tsx`). */
export function traceIdOfError(error: unknown): string | null {
  return typeof error === 'object' && error !== null ? (TRACES.get(error) ?? null) : null;
}

export function api(): ApiClient {
  return readsThrough(sessionFetch);
}

/**
 * `fetch` with no session on it: no `Authorization`, whatever the keychain holds. Still shown to
 * the maintenance trigger, like every response.
 */
const anonymousFetch: Fetch = async (url, init) => {
  const headers = new Headers(init?.headers);
  headers.delete('Authorization');
  return rememberTrace(await observeResponse(await fetch(url, { ...init, headers })));
};

/**
 * Reads made as nobody — the public campaign page's FAQ and updates, and a creator's public
 * profile (#155).
 *
 * <h2>Why a public page must not say who is reading</h2>
 *
 * `GET /v1/projects/{id}/updates` and `/faqs` answer a member of the campaign's team with more
 * than the public sees: updates scheduled for later, and the lists of a campaign that is not
 * public at all (the service answers `Cache-Control: private` when it does). That is right
 * for the creator's dashboard and wrong for the campaign page, which is the public's — and on a
 * phone it is worse, because the page's reads are persisted to an unencrypted store (`lib/
 * offline.ts`), where the team's private text would sit for a week. The web reads these endpoints
 * anonymously on purpose (`apps/web/src/lib/community/updates.ts`, `lib/profiles/server.ts`), and
 * this is the same arrangement: the page shows what everybody is shown.
 */
export function publicApi(): ApiClient {
  return readsThrough(anonymousFetch);
}

function readsThrough(transport: Fetch): ApiClient {
  const get: ApiClient['get'] = (path, options) => {
    /*
     * A client per read, so the response a refusal came from is this read's and not a
     * concurrent one's: the transport sees the response before `createApiClient` turns it
     * into an `ApiError`, and this remembers its trace id until the error appears.
     */
    let traceId: string | null = null;
    const client = createApiClient({
      baseUrl: apiOrigin(),
      headers: { 'Accept-Language': currentLocale() },
      fetch: async (url, init) => {
        const response = await transport(url, init);
        traceId = traceIdOf(response);
        return response;
      },
    });
    return client.get(path, options).catch((cause: unknown) => {
      if (cause instanceof ApiError && traceId !== null) TRACES.set(cause, traceId);
      throw cause;
    });
  };
  return { get };
}

/**
 * One JSON write through the session — the pre-launch reminder (#155) is the first caller.
 *
 * <p>Through {@link sessionFetch}, like every read, so a signed-in reader's write carries the
 * bearer (and survives an expired access token by the same one refresh), and a guest's carries
 * none. That is the arrangement the web's `publicFetch` makes for the same endpoints: a write
 * that needs no session still says who is asking when there is somebody to say.
 *
 * <p>A refusal is thrown as the shared `ApiError`, from `errorFrom`, so `retryAfterSeconds` is
 * filled from the `Retry-After` header and the screen reads `problem.code` exactly as the web
 * does. A body-less success (`204`) answers `null`. Not for a payment: a pledge needs an
 * `Idempotency-Key`, which this deliberately does not add, and checkout writes its own.
 */
export async function sendJson(
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  extraHeaders: Readonly<Record<string, string>> = {},
): Promise<unknown> {
  const response = await sessionFetch(`${apiOrigin()}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      'Accept-Language': currentLocale(),
      ...extraHeaders,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  if (!response.ok) {
    const error = await errorFrom(response);
    const traceId = traceIdOf(response);
    if (traceId !== null) TRACES.set(error, traceId);
    throw error;
  }
  // Read as text first: `json()` on an empty body throws, which would turn a 204 into a failure.
  const text = await response.text();
  return text === '' ? null : (JSON.parse(text) as unknown);
}

/**
 * A JSON write whose answer is a file rather than JSON — the backer export (#163). Like
 * {@link sendJson} in every way but the answer: its text, and the headers the file describes
 * itself with (`Content-Disposition`, `X-Export-Rows`, `X-Export-Truncated`).
 */
export async function sendJsonForFile(
  path: string,
  body: unknown,
): Promise<{ readonly text: string; readonly headers: Headers }> {
  const response = await sessionFetch(`${apiOrigin()}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'text/csv, application/problem+json',
      'Accept-Language': currentLocale(),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await errorFrom(response);
    const traceId = traceIdOf(response);
    if (traceId !== null) TRACES.set(error, traceId);
    throw error;
  }
  return { text: await response.text(), headers: response.headers };
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
