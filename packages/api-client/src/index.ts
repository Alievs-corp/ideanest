/**
 * `@ideanest/api-client` — the typed surface of the IdeyaNest API (#136).
 *
 * Three things, in order of how much they matter:
 *
 *   1. **`schema.ts`** — every path, parameter and body in the service, generated from
 *      `apps/api/openapi.json` by `pnpm --filter @ideanest/api-client generate`. This is the
 *      whole point of the package. Do not edit it; regenerate it.
 *   2. **`problem.ts`** — §10.4's error shape, which every client needs and which nothing
 *      generates because it is the shape of a failure rather than of an endpoint.
 *   3. **`client.ts`** — fifty lines that turn a path type into a function call, with no
 *      runtime dependency of its own. See that file for why it is not `openapi-fetch`.
 */
export { createApiClient } from './client';
export type {
  ApiClient,
  ApiClientOptions,
  Fetch,
  GetOptions,
  GetPath,
  GetPathParams,
  GetQueryParams,
  GetResponse,
} from './client';

export { ApiError, TRACE_ID_HEADER, errorFrom, problemFrom, traceIdOf } from './problem';
export type { Problem } from './problem';

export type { components, operations, paths } from './schema';
