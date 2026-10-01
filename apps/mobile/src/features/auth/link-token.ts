import { useEffect, useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { announce } from '../../components/ui';

/**
 * The `token` an emailed link carries — verify-email, the reset confirm, the email change
 * (issue #152).
 *
 * <p>Read into state and taken OFF the route straight away: a route param is part of a URL, and a
 * URL is what navigation state, a crash report or an analytics event carries. The token is a
 * credential — for an hour, six hours, a day — and it is never logged or sent anywhere but the one
 * endpoint that spends it.
 *
 * <p><strong>A newer link replaces the one held.</strong> Opening a link while its screen is
 * already showing reuses the screen and changes only its params, and the emails tell people to use
 * the most recent message. So a different token is adopted rather than stripped and dropped; the
 * route files key their view on it, which starts that view — and its spend-once guard — afresh.
 *
 * <p>Held in this screen's state, so a remount after a render error has nothing to read: the
 * route no longer carries it. That case falls back to the no-token state, which says to open the
 * link again — which works, because a reset link is spent by its submit and not by being opened.
 *
 * @returns the trimmed token, or `''` when the screen was opened without one
 */
export function useLinkToken(): string {
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token?: string }>();
  const arrived = typeof token === 'string' ? token.trim() : '';
  const [held, setHeld] = useState(arrived);

  if (arrived !== '' && arrived !== held) setHeld(arrived);

  useEffect(() => {
    if (token !== undefined) router.setParams({ token: undefined });
  }, [token, router]);

  return arrived !== '' ? arrived : held;
}

/**
 * Each token's one request, kept for the life of the process. One tapped link can mount its
 * screen twice — Expo Router routes the URL, and the root's link handler may push the same path —
 * and Strict Mode runs a mount's effect twice. Every one of those reads the same answer; none of
 * them sends a second request, which would be "already used" drawn over a success.
 */
const requests = new Map<string, Promise<void>>();

/** Test hook: forget every request this process has made. */
export function forgetSpentTokens(): void {
  requests.clear();
}

/**
 * Spends `token` with `request` once per process, and hands this mount the outcome. Not a
 * TanStack query: a query is retried, refetched and persisted, and every one of those would be a
 * second request.
 */
export function useSpendOnce(
  token: string,
  request: (token: string) => Promise<void>,
  outcome: { readonly done: () => void; readonly failed: (cause: unknown) => void },
): void {
  const latest = useRef({ request, outcome });
  latest.current = { request, outcome };

  useEffect(() => {
    if (token === '') return;
    let live = true;
    let pending = requests.get(token);
    if (pending === undefined) {
      pending = latest.current.request(token);
      requests.set(token, pending);
    }
    pending.then(
      () => {
        if (live) latest.current.outcome.done();
      },
      (cause: unknown) => {
        if (live) latest.current.outcome.failed(cause);
      },
    );
    return () => {
      live = false;
    };
  }, [token]);
}

/**
 * Says a status to the screen reader when it changes: the web's polite live region, which on a
 * phone is `announceForAccessibility` on both platforms — a live region inserted with its message
 * already in it is read as ordinary content rather than announced.
 */
export function useStatusAnnouncement(message: string): void {
  const said = useRef('');
  useEffect(() => {
    if (message === '' || message === said.current) return;
    said.current = message;
    announce(message);
  }, [message]);
}
