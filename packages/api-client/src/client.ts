import type { paths } from './schema';
import { ApiError, problemFrom } from './problem';

/**
 * A typed reader for the IdeyaNest API — #136.
 *
 * <h2>Why this is hand-written and tiny</h2>
 *
 * The types in `schema.ts` are generated and are the valuable half. What is here is the
 * fifty lines that turn `paths['/v1/discover']['get']` into a function call, and it is
 * deliberately not a library.
 *
 * `openapi-fetch` would do the same job. It was not taken because this package is imported
 * by `@ideanest/web`, whose First Load JS is a budget CI fails on
 * (`apps/web/performance/check-first-load-js.mjs`), and by a React Native application that
 * does not exist yet. A runtime dependency in a package both of them import is a dependency
 * neither of them can drop, in exchange for behaviour that fits on one screen.
 *
 * Zero dependencies is also what makes this usable from a Next.js Server Component, from a
 * browser, and from Hermes without a polyfill: the only global it touches is `fetch`, and
 * that is injectable.
 *
 * <h2>What it does not do</h2>
 *
 * **No token handling, no refresh, no retry.** `apps/web/src/lib/api` owns those, because
 * they are decisions about a session rather than about a request: the fifteen-minute access
 * token, the `SameSite=Strict` refresh cookie, and the rule that a second 401 is a refusal
 * rather than an expiry are all properties of the web client's own auth flow, and mobile's
 * will differ. This takes headers and returns bodies.
 *
 * **Only reads, for now.** Every method below is a `GET`. Writes on this platform carry
 * `Idempotency-Key` (§10.3), and a client that made it easy to send a payment mutation
 * without one would be the wrong shape for the one rule that matters most. When a write
 * belongs here it arrives with that header in its signature.
 */

/** Just enough of `fetch` to be injectable in a test or a server runtime. */
export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface ApiClientOptions {
  /**
   * What every path is resolved against.
   *
   * Empty by default, which means same-origin — the arrangement `next.config.mjs` describes
   * and the only one in which the browser attaches the refresh cookie. A server render
   * passes the service's own origin, because there is no proxy in front of a `fetch` made
   * inside the server.
   */
  readonly baseUrl?: string;

  /** Sent on every request. A caller's own headers win over these. */
  readonly headers?: Readonly<Record<string, string>>;

  /** Defaults to the global. Injectable so a test needs no network and no server. */
  readonly fetch?: Fetch;
}

/** The paths this client can `GET`. */
export type GetPath = {
  [P in keyof paths]: paths[P] extends { get: object } ? P : never;
}[keyof paths];

/** The 200 body of a `GET`, as the contract describes it. */
export type GetResponse<P extends GetPath> = paths[P] extends {
  get: { responses: { 200: { content: { 'application/json': infer Body } } } };
}
  ? Body
  : never;

/** The path parameters a `GET` takes, or `never` when it takes none. */
export type GetPathParams<P extends GetPath> = paths[P] extends {
  get: { parameters: { path: infer Params } };
}
  ? Params extends undefined
    ? never
    : Params
  : never;

/** The query parameters a `GET` accepts, or `never` when it accepts none. */
export type GetQueryParams<P extends GetPath> = paths[P] extends {
  get: { parameters: { query?: infer Query } };
}
  ? Query extends undefined
    ? never
    : Query
  : never;

export interface GetOptions<P extends GetPath> {
  /**
   * The `{name}` segments of the path.
   *
   * Required by the type when the path has any, which is the whole reason this is not a
   * string concatenation at the call site: a template written by hand can be one segment
   * short, and the failure is a 404 at run time rather than a red squiggle.
   */
  readonly path?: GetPathParams<P>;
  readonly query?: GetQueryParams<P>;
  readonly headers?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
  /**
   * Passed straight to `fetch`.
   *
   * Named rather than merged from a `RequestInit`, because the values that matter here are
   * decisions — `no-store` on a read that must never be stale, a `revalidate` on one a
   * server render may hold — and burying them in a spread makes them invisible in review.
   */
  readonly cache?: RequestCache;
  /** Next.js's per-request cache directives. Ignored by every other runtime. */
  readonly next?: { readonly revalidate?: number | false; readonly tags?: readonly string[] };
}

export interface ApiClient {
  get<P extends GetPath>(path: P, options?: GetOptions<P>): Promise<GetResponse<P>>;
}

/**
 * A client bound to an origin.
 *
 * @throws ApiError from every method, for any response that is not 2xx. Returning a union
 *     of "body or problem" was the alternative and it is worse in exactly the place it
 *     matters: a caller that forgets to narrow it renders a problem detail as a campaign,
 *     whereas a caller that forgets to catch gets a stack trace naming the endpoint.
 */
export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const baseUrl = options.baseUrl ?? '';
  const send = options.fetch ?? globalThis.fetch;

  return {
    async get(path, request) {
      const url = baseUrl + interpolate(path, request?.path) + queryString(request?.query);

      const response = await send(url, {
        method: 'GET',
        headers: { accept: 'application/json', ...options.headers, ...request?.headers },
        signal: request?.signal,
        ...(request?.cache === undefined ? {} : { cache: request.cache }),
        ...(request?.next === undefined ? {} : { next: request.next }),
      } as RequestInit);

      if (!response.ok) {
        throw new ApiError(response.status, await problemFrom(response));
      }

      /*
       * 204 and 304 carry no body, and `response.json()` on either throws a parse error
       * that names nothing. Neither is reachable through a typed `GET` today — every path
       * in the contract answers 200 with a body — so this is the branch that keeps a future
       * one from failing obscurely rather than one that runs.
       */
      if (response.status === 204 || response.status === 304) {
        return undefined as never;
      }
      return (await response.json()) as never;
    },
  };
}

/**
 * Substitutes `{name}` segments, encoding each value.
 *
 * Encoded because a slug is a value somebody chose: `users_slug_shape` happens to forbid a
 * slash today, and a client that relied on that would break the day another identifier with
 * looser rules appears in a path.
 */
function interpolate(path: string, params: unknown): string {
  if (params === undefined || params === null) {
    return path;
  }
  const values = params as Record<string, string | number>;
  return path.replace(/\{([^}]+)\}/g, (_match, name: string) => {
    const value = values[name];
    if (value === undefined) {
      // A missing segment would otherwise be sent as the literal `{name}` and answered 404,
      // which is a bug report about the wrong thing.
      throw new Error(`The path ${path} needs a value for {${name}}`);
    }
    return encodeURIComponent(String(value));
  });
}

/**
 * The query string, or the empty string.
 *
 * An array becomes a repeated parameter rather than a comma-joined one, because that is what
 * `DiscoveryQueryBinder` reads — it binds a `MultiValueMap`, and a comma-joined list arrives
 * as one value containing commas.
 *
 * `undefined` and `null` are dropped. An absent filter and a filter set to nothing are the
 * same request, and sending `?category=` would make the service parse an empty category.
 */
function queryString(query: unknown): string {
  if (query === undefined || query === null) {
    return '';
  }
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(query as Record<string, unknown>)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null) search.append(name, String(item));
      }
      continue;
    }
    search.append(name, String(value));
  }
  const encoded = search.toString();
  return encoded === '' ? '' : `?${encoded}`;
}
