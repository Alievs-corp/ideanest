import { onlineManager, useQuery } from '@tanstack/react-query';
import { ApiError, type GetResponse } from '@ideanest/api-client';
import { api } from '../api/client';
import { currentAccessToken, hasStoredSession } from './session';
import { useSession, type Session } from './use-session';

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
 * - `signed-out`: no token on the phone, or the service said 401/404 to a credential that
 *   was presented (revoked, or the account is gone);
 * - `unknown`: a token is on the phone and the service could not be asked — offline, a
 *   5xx, or the biometric lock not yet (or not) unlocked. Nothing account-shaped is drawn, and above all the shell does **not**
 *   fall back to "Sign in": that would offer a sign-in button to somebody who already has
 *   an account during an outage — the web's `fetchSession` draws the same line.
 */
export type Me = GetResponse<'/v1/me'>;
export type SessionState = 'signed-in' | 'signed-out' | 'unknown';

/**
 * A 401 for a request that carried no bearer, while the phone still holds a session.
 *
 * <p>That is the biometric prompt dismissed (or the keychain refusing), not the service saying
 * nobody is there: nothing was presented for it to refuse. Read as "nobody", it turned a
 * locked reader into a signed-out one — "Sign in" offered to somebody who is signed in, and
 * This phone and Sign out (the only way to turn the lock off) hidden.
 */
export class NoCredentialError extends Error {
  constructor() {
    super('The account read went out without a bearer; the stored session was not unlocked.');
    this.name = 'NoCredentialError';
  }
}

/**
 * The one read the shell makes of the account. `null` is the service's "nobody".
 *
 * `null` only when a credential was actually presented and refused (401), or presented and
 * its account is gone (404). A revoked refresh token ends the stored session on its way
 * here (`lib/auth.ts`), so that case still reads as "nobody"; a prompt that was dismissed
 * leaves the session in place and throws {@link NoCredentialError} instead, which the shell
 * reads as unknown.
 */
export async function fetchMe(signal?: AbortSignal): Promise<Me | null> {
  try {
    return await api().get('/v1/me', { signal });
  } catch (cause) {
    if (cause instanceof ApiError && (cause.status === 401 || cause.status === 404)) {
      if (hasStoredSession() && currentAccessToken() === null) throw new NoCredentialError();
      return null;
    }
    throw cause;
  }
}

/** The badge number, or `null` when there is no inbox to count. One row: only the count is read. */
export async function fetchUnreadCount(signal?: AbortSignal): Promise<number | null> {
  try {
    const inbox = await api().get('/v1/me/notifications', { query: { limit: 1 }, signal });
    return inbox.unreadCount ?? 0;
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 401) return null;
    throw cause;
  }
}

/** Roots of the two queries, so a foreground or a push can refresh exactly these. */
export const ACCOUNT_KEYS = { me: ['me'] as const, unread: ['unread'] as const };

/**
 * The pure half of {@link useSessionState}, so the rule is testable without a tree.
 *
 * `canRead` false (the lock armed and not unlocked, {@link canReadAccount}) is unknown even
 * with an account in the cache: a signed-in answer would enable the unread-count read, and
 * that read is a biometric prompt nobody asked for.
 */
export function sessionStateOf(input: {
  readonly hasToken: boolean;
  readonly canRead?: boolean;
  readonly me: Me | null | undefined;
}): SessionState {
  if (!input.hasToken) return 'signed-out';
  if (input.canRead === false || input.me === undefined) return 'unknown';
  return input.me === null ? 'signed-out' : 'signed-in';
}

/**
 * Whether the account can be read without showing the biometric prompt.
 *
 * With the lock armed and nothing unlocked in this process, reading `GET /v1/me` would put the
 * prompt up for the header's sake — at launch, and again after every two minutes away — when
 * the lock's own promise (`mobile.lock.armed`) is that the phone asks when pledges are read.
 * So the shell waits: the account reads as unknown until something that needs the token has
 * unlocked it, and then it is read.
 */
export function canReadAccount(session: Session): boolean {
  return session.signedIn && (!session.locked || session.unlocked);
}

/** `GET /v1/me`. Not persisted: this store is unencrypted and the email is the reader's own. */
export function useMe() {
  const session = useSession();
  return useQuery({
    queryKey: [...ACCOUNT_KEYS.me, session.signedIn],
    queryFn: ({ signal }) => fetchMe(signal),
    enabled: canReadAccount(session),
    staleTime: 60_000,
    retry: retryMe,
  });
}

/**
 * Whether a failed `GET /v1/me` is tried again.
 *
 * <p>Backoff, so an outage that ends while the app is open is noticed without a foreground.
 * Never after a missing credential: each retry would be another biometric prompt. And never
 * while offline — `lib/offline.ts`'s `shouldRetry` gives the reason: with `onlineManager` told
 * the truth (issue #150), a retry decided on offline pauses instead of failing, and a paused
 * account read would hold the Me tab on its skeleton for as long as the plane is in the air.
 */
export function retryMe(failures: number, error: unknown): boolean {
  return !(error instanceof NoCredentialError) && failures < 3 && onlineManager.isOnline();
}

export function useSessionState(): SessionState {
  const session = useSession();
  const { data } = useMe();
  return sessionStateOf({
    hasToken: session.signedIn,
    canRead: canReadAccount(session),
    me: data,
  });
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

/** The bell's pill: `9+` past nine, nothing at zero (#160). The exact count is in the bell's name. */
export function badgeText(count: number): string | null {
  if (count <= 0) return null;
  return count > 9 ? '9+' : String(count);
}
