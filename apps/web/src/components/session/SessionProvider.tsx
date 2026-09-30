'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { usePathname, useRouter } from '../../i18n/navigation';
import { signOut as clearSession } from '../../lib/api/access-token';
import { signInHref } from '../../lib/auth/redirect';
import { requiresSession } from '../../lib/session/private-routes';
import { fetchSession, type Session } from '../../lib/session/session';

/**
 * The session, read once per page load and handed to whatever asks — #267.
 *
 * <h2>Why this is a client boundary and not a server read</h2>
 *
 * THE ISSUE ASKS FOR THE SESSION TO BE READ ON THE SERVER, AND IT CANNOT BE, for a reason
 * that is in the service's configuration rather than in this application: the refresh
 * cookie is issued on `Path=/v1/auth` (`ideanest.auth.refresh-cookie.path`). A browser
 * sends a cookie only to paths under its own, so a request for `/` — or for any page in
 * this application — carries nothing for `cookies()` to read. There is no session on the
 * server to expose, whatever this file does.
 *
 * That scope is not an accident to route around. `AuthProperties.RefreshCookie` states it:
 * the cookie is narrowed so it is not attached to every request to the API, which is what
 * keeps a thirty-day credential off requests that have no use for it. Widening it is a
 * change to the service and belongs to whoever owns §17, not to an epic whose stated scope
 * is "the web client only".
 *
 * So the bootstrap happens here, once, on mount: `fetchSession` spends the refresh cookie
 * against `/v1/auth/refresh` — a path the cookie IS sent to — and reads `GET /v1/me` with
 * the access token that comes back. What that costs, honestly, is one round trip after
 * hydration before the header knows who is reading. What it buys is that the token never
 * leaves memory. The gap and its follow-up are named in `apps/web/README.md`.
 *
 * <h2>Three states, not two</h2>
 *
 * `unknown` is a state anything reading this has to render, and collapsing it into
 * "signed out" is the bug it exists to prevent: the shell would paint Sign in and Register
 * for a signed-in reader on every single page load, then swap them a moment later. It is
 * also the state the server renders, so it is what hydration matches against.
 *
 * <h2>The guard lives here</h2>
 *
 * One place that knows both "is there a session" and "which page is this", so no private
 * route has to remember to guard itself — a rule that is enforced by being unnecessary
 * rather than by review. `lib/session/private-routes.ts` is the list, and it is deliberately
 * not the crawler's list.
 *
 * <h2>It also keeps the account's language and the cookie in step</h2>
 *
 * `GET /v1/me` carries `locale` (#324), and this is the only place in the client that reads
 * that response on every page load — so it is the only place that can notice the account and
 * the browser disagreeing. {@link syncLocale} below says which side wins and why (#216).
 */

export type SessionStatus = 'unknown' | 'signed-in' | 'signed-out';

/**
 * THE ACCOUNT'S LANGUAGE AND THIS BROWSER'S, KEPT IN STEP — #324, #280, then #216.
 *
 * `users.locale` is the durable record and it travels with the account: mail and pushes are
 * sent in it. The cookie is per browser, and it is what `proxy.ts` answers the bare path with.
 * Every page load already reads `GET /v1/me` to bootstrap the session, and that response
 * carries the language, so noticing a disagreement costs nothing extra.
 *
 * WHO WINS A DISAGREEMENT: THE LATEST EXPLICIT CHOICE (#216). It used to be the account,
 * always — the cookie was overwritten on every session read, so the header's switcher lasted
 * only for the URL it opened. Now every explicit choice (this browser's switcher and settings
 * panel, a phone's language screen or per-app setting) is written to the account, and the
 * account's value reaches this browser only when the browser has no choice of its own or the
 * account changed elsewhere since this browser last synced it. `lib/i18n/sync.ts` is the rule.
 * A read that finds nobody, and a sign-out, keep the cookie and forget the sync marks, so the
 * next person to sign in here follows their own account.
 *
 * LOADED AFTER THE READ, NOT WITH THE PAGE. This provider is in the root layout, so whatever
 * it imports statically is in every route's First Load JS, and those budgets have no room for
 * a rule that cannot run before the read has answered anyway. The import is the whole cost
 * here; a failed one leaves the cookie as it was, which is the state before this existed.
 *
 * NO `router.refresh()`. The mirror this replaces refreshed the server tree after writing the
 * cookie, from when a render read it. Since #123 the language is the path's and nothing a
 * render draws reads the cookie (`src/i18n/request.ts`), so the refresh was a round trip that
 * could not change anything on screen.
 *
 * A VALUE THAT IS ABSENT OR UNKNOWN IS LEFT ALONE. `locale` is optional in the generated
 * schema, and a tag outside §21.1's four is a language this client cannot draw — "nothing to
 * apply", not "apply the default".
 */
function syncLocale(account: Session | null): void {
  void import('../../lib/i18n/sync').then((sync) => sync.syncLocale(account));
}

export interface SessionState {
  readonly status: SessionStatus;
  /** The account, and only when `status` is `signed-in`. */
  readonly session: Session | null;
  /** Re-reads `GET /v1/me` — after a profile change, or after a sign-in in another tab. */
  readonly refresh: () => Promise<void>;
  /** Ends this browser's session and returns to the home page. */
  readonly signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

/**
 * The session, from anywhere under the provider.
 *
 * Throws rather than answering a default when there is no provider above it. A default
 * would be "signed out", and a component that silently renders its signed-out branch
 * because somebody forgot a provider is a defect that reaches production looking like a
 * design decision.
 */
export function useSession(): SessionState {
  const state = useContext(SessionContext);
  if (state === null) {
    throw new Error('useSession was called outside <SessionProvider>.');
  }
  return state;
}

export interface SessionProviderProps {
  readonly children: ReactNode;
}

export function SessionProvider({ children }: SessionProviderProps) {
  const router = useRouter();
  const pathname = usePathname();

  const [status, setStatus] = useState<SessionStatus>('unknown');
  const [session, setSession] = useState<Session | null>(null);

  const read = useCallback(async () => {
    try {
      const account = await fetchSession();
      setSession(account);
      setStatus(account === null ? 'signed-out' : 'signed-in');
      syncLocale(account);
    } catch {
      /*
       * THE SERVICE FAILED, WHICH IS NOT THE SAME AS BEING SIGNED OUT, so nothing is
       * written and the state is left exactly as it was. `fetchSession` already turns every
       * "there is no session" answer into `null`, so reaching here means a 500, a timeout,
       * or a service that could not be reached at all.
       *
       * Holding at `unknown` is what stops the guard below from marching somebody off the
       * page they were reading because the API restarted, and what stops the header from
       * offering Register to somebody who is already signed in. The cost is that the shell
       * shows its neutral state until something asks again, which is the right way round: a
       * header that says nothing is recoverable, and a redirect is not.
       */
    }
  }, []);

  useEffect(() => {
    void read();
  }, [read]);

  /*
   * The guard. It waits for `unknown` to resolve, because redirecting before the answer is
   * known would send every signed-in reader to the sign-in page on every load.
   *
   * `replace`, not `push`: the private URL was never a page this reader saw, and leaving it
   * in the history means Back walks them straight into the redirect again.
   *
   * The query string is carried into `?next=` along with the path, so a reader interrupted
   * on `/settings/sessions?tab=x` comes back to that screen rather than to its default. It
   * is read from `location` inside the effect rather than through `useSearchParams`,
   * because this provider wraps the ROOT layout: `useSearchParams` in a component that high
   * would opt every statically rendered route in the application into client-side rendering
   * unless each one grew a `Suspense` boundary for it. Inside an effect there is always a
   * `location` and there is never a server render to disagree with.
   */
  useEffect(() => {
    if (status !== 'signed-out') return;
    if (!requiresSession(pathname)) return;

    const query = window.location.search;
    router.replace(signInHref(`${pathname}${query}`));
  }, [status, pathname, router]);

  const signOut = useCallback(async () => {
    /*
     * The local state goes first, for the reason `lib/api/access-token.ts` gives about the
     * token itself: if the network call fails the reader is still signed out here, which is
     * the safer of the two ways to be wrong.
     */
    setSession(null);
    setStatus('signed-out');
    syncLocale(null);
    await clearSession();

    /*
     * `push` to the home page rather than staying put. Staying put on a private route would
     * hand the reader straight to the guard above, and a sign-out that ends on a sign-in
     * form reads as a sign-out that failed.
     */
    router.push('/');
    router.refresh();
  }, [router]);

  const value = useMemo<SessionState>(
    () => ({ status, session, refresh: read, signOut }),
    [status, session, read, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
