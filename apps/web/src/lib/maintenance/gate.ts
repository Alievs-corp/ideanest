import type { Maintenance } from '@ideanest/api-client/maintenance';
import { isLocale } from '../i18n/locale';
import { apiOrigin } from '../seo/metadata-source';
import { readPlatformStatus, STATUS_PATH, type PlatformStatus } from './status';

/**
 * Which pages the proxy closes during a maintenance window, and how it knows — §19.6, #214.
 *
 * <h2>Why the proxy and not the page</h2>
 *
 * A maintenance answer is a `503` with a `Retry-After`: that is what tells a crawler the page
 * is away rather than gone, and what keeps it in the index. A Server Component cannot set a
 * status — by the time it learns its read was refused, the response has started — so the
 * decision is taken before rendering, where a status can still be chosen: the proxy asks
 * `GET /v1/status` and, during a window, rewrites the request to the existing `/maintenance`
 * page with `503`, `Retry-After` and `no-store`. The address in the bar stays where the reader
 * was, which is also what lets that page take them back when it is over.
 *
 * <h2>A snapshot, not a request per page</h2>
 *
 * The service holds its own window state in a ten-second snapshot, so asking more often than
 * that learns nothing. {@link statusSnapshot} keeps the last answer for ten seconds and, once
 * it is older, answers from it while one refresh runs behind — so a page waits on the status
 * endpoint only on the first request a server instance ever handles, and then for at most
 * {@link STATUS_TIMEOUT_MS}. A start or an end reaches readers within about twenty seconds.
 *
 * <h2>What stays open</h2>
 *
 * The console, and the sign-in page that leads to it: staff keep working through a window,
 * and the service lets their token through. Every other page closes, including the account
 * pages a member of staff could otherwise have used — a page render here is anonymous (the
 * refresh cookie lives on `/v1/auth`), so the proxy cannot tell a member of staff from a
 * reader, and a page that half-works for a reader is worse than the maintenance page.
 *
 * Not knowing is not maintenance. An unreachable status endpoint, a bare `503` or a body that
 * is not the contract leaves every page open, and each page then renders its own failure
 * state exactly as it did before #214.
 */

/** How long one answer stands. The service's own snapshot is ten seconds. */
export const SNAPSHOT_MS = 10_000;

/** How long a page may wait on the status endpoint, on the one request that waits at all. */
export const STATUS_TIMEOUT_MS = 1_500;

/** The first segment after the language, for the pages that stay open during a window. */
const OPEN_SECTIONS: ReadonlySet<string> = new Set(['admin', 'sign-in']);

/**
 * The page a request is answered with during a window, or null when it stays open.
 *
 * `/maintenance` itself is included, so that the page answers `503` when it is reached
 * directly — by the client redirect, or by somebody who kept the tab.
 */
export function maintenancePageFor(pathname: string): string | null {
  const segments = pathname.split('/');
  const locale = segments[1];
  if (!isLocale(locale)) return null;
  if (OPEN_SECTIONS.has(segments[2] ?? '')) return null;

  return `/${locale}/maintenance`;
}

/** The headers of a maintenance answer, as the contract has them. */
export function maintenanceHeaders(maintenance: Maintenance): Record<string, string> {
  return {
    'retry-after': String(maintenance.retryAfterSeconds),
    'cache-control': 'no-store',
  };
}

export interface StatusSnapshot {
  /** The last known status, or null when it is not known. */
  current(): Promise<PlatformStatus | null>;
}

export function statusSnapshot(
  read: () => Promise<PlatformStatus | null>,
  clock: () => number = Date.now,
  ttlMs: number = SNAPSHOT_MS,
): StatusSnapshot {
  let value: PlatformStatus | null = null;
  let readAt: number | null = null;
  let pending: Promise<PlatformStatus | null> | null = null;

  function refresh(): Promise<PlatformStatus | null> {
    pending ??= read()
      .catch(() => null)
      .then((next) => {
        value = next;
        readAt = clock();
        pending = null;
        return next;
      });
    return pending;
  }

  return {
    async current() {
      if (readAt === null) return refresh();
      if (clock() - readAt >= ttlMs) void refresh();
      return value;
    },
  };
}

/** The proxy's snapshot, one per server process. */
export const platformStatus: StatusSnapshot = statusSnapshot(() =>
  readPlatformStatus(`${apiOrigin()}${STATUS_PATH}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
  }),
);
