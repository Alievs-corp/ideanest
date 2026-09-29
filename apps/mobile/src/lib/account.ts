import { useQuery } from '@tanstack/react-query';
import { ApiError, type GetResponse } from '@ideanest/api-client';
import { api } from '../api/client';
import { useSession } from './use-session';

/**
 * Who is signed in, as `GET /v1/me` says — issue #150.
 *
 * <h2>Three answers, not two</h2>
 *
 * `use-session.ts` knows whether this phone holds a token. It cannot know whether the
 * service still honours it, and it has no name, slug or language. This reads them, and
 * reports one of:
 *
 * - `signed-in`: the service answered with the account;
 * - `signed-out`: no token on the phone, or the service said 401/404 (revoked, or the
 *   account is gone);
 * - `unknown`: a token is on the phone and the service could not be asked, or answered
 *   with a 5xx. Nothing account-shaped is drawn, and above all the shell does **not**
 *   fall back to "Sign in": that would offer a sign-in button to somebody who already has
 *   an account during an outage — the web's `fetchSession` draws the same line.
 */
export type Me = GetResponse<'/v1/me'>;
export type SessionState = 'signed-in' | 'signed-out' | 'unknown';

/** The one read the shell makes of the account. `null` is the service's "nobody". */
export async function fetchMe(signal?: AbortSignal): Promise<Me | null> {
  try {
    return await api().get('/v1/me', { signal });
  } catch (cause) {
    if (cause instanceof ApiError && (cause.status === 401 || cause.status === 404)) return null;
    throw cause;
  }
}

/** The badge number, or `null` when there is no inbox to count. */
export async function fetchUnreadCount(signal?: AbortSignal): Promise<number | null> {
  try {
    const inbox = await api().get('/v1/me/notifications', { signal });
    return inbox.unreadCount ?? 0;
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 401) return null;
    throw cause;
  }
}

/** Roots of the two queries, so a foreground or a push can refresh exactly these. */
export const ACCOUNT_KEYS = { me: ['me'] as const, unread: ['unread'] as const };

/** The pure half of {@link useSessionState}, so the rule is testable without a tree. */
export function sessionStateOf(input: {
  readonly hasToken: boolean;
  readonly me: Me | null | undefined;
}): SessionState {
  if (!input.hasToken) return 'signed-out';
  if (input.me === undefined) return 'unknown';
  return input.me === null ? 'signed-out' : 'signed-in';
}

/** `GET /v1/me`. Not persisted: this store is unencrypted and the email is the reader's own. */
export function useMe() {
  const { signedIn } = useSession();
  return useQuery({
    queryKey: [...ACCOUNT_KEYS.me, signedIn],
    queryFn: ({ signal }) => fetchMe(signal),
    enabled: signedIn,
    staleTime: 60_000,
    retry: 1,
  });
}

export function useSessionState(): SessionState {
  const { signedIn } = useSession();
  const { data } = useMe();
  return sessionStateOf({ hasToken: signedIn, me: data });
}

/** The unread count for the header bell; `undefined` until known, and on any failure. */
export function useUnreadCount(): number | undefined {
  const state = useSessionState();
  const { data } = useQuery({
    queryKey: [...ACCOUNT_KEYS.unread],
    queryFn: ({ signal }) => fetchUnreadCount(signal),
    enabled: state === 'signed-in',
    staleTime: 30_000,
    retry: false,
  });
  return data ?? undefined;
}

/** `99+` past ninety-nine, as the web's badge draws it. */
export function badgeText(count: number): string | null {
  if (count <= 0) return null;
  return count > 99 ? '99+' : String(count);
}
