import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { ACCOUNT_KEYS, canReadAccount, useMe } from './account';
import { sweepAccountExports } from './account-export-files';
import {
  applyAccountLocale,
  forgetAccountSync,
  pushPendingLocale,
  reconcileWithAccount,
} from './locale-sync';
import { ACCOUNT_ROOTS, forgetPersistedCache } from './offline';
import { forgetUnsentEdits } from './unsent-edits';
import { useSession } from './use-session';

/**
 * Keeps the shell's picture of the account current — issues #150 and #216. Renders nothing.
 *
 * - **Account language.** On every read of `GET /v1/me`, `lib/locale.ts`'s last-synced rule:
 *   the account's language is applied when this device has no explicit choice of its own or
 *   the account changed elsewhere since this device last synced it; a choice made here that
 *   the account has not accepted yet is sent instead. Every read, not once per launch: the
 *   pending mark is what stops a refetch landing between a language tap and its `PATCH` from
 *   switching the app back.
 * - **The pending `PATCH`.** Sent when the account becomes readable (launch, unlock) and on
 *   every foreground, so a choice made offline reaches the account once the phone is back.
 * - **Sign-out.** Whatever ends the session, the device keeps its language and forgets which
 *   account it last synced with, and every cache root in `ACCOUNT_ROOTS` is removed. When a
 *   session this launch held ends, the persisted cache is erased as well and the exports left on
 *   the phone are swept: a revoked refresh token ends the session without the sign-out screens,
 *   which do the same.
 * - **Foreground.** Coming back to the app refreshes the account and the unread count. A push
 *   arriving while it is open is `PushSync`'s (`lib/push-sync.tsx`).
 */
export function AccountSync() {
  const queryClient = useQueryClient();
  const { data } = useMe();
  const session = useSession();
  const { signedIn } = session;
  const canRead = canReadAccount(session);

  // Read by the foreground listener, which is registered once.
  const readable = useRef(canRead);
  useEffect(() => {
    readable.current = canRead;
  }, [canRead]);

  // Whatever ends the session — sign-out, a revoked token, a 401 elsewhere — the next person
  // to sign in must not see this account's name or badge from the cache, and must be met by
  // their own account's language rather than kept on a choice this account made.
  const held = useRef(signedIn);
  useEffect(() => {
    if (signedIn) {
      held.current = true;
      return;
    }
    queryClient.removeQueries({ queryKey: ACCOUNT_KEYS.me });
    queryClient.removeQueries({ queryKey: ACCOUNT_KEYS.unread });
    for (const root of ACCOUNT_ROOTS) queryClient.removeQueries({ queryKey: [root] });
    forgetAccountSync();
    // Not on a signed-out launch: a guest's cached campaign pages are nobody's, and the document
    // is still being restored then. The persister writes back what is left at its next save.
    if (held.current) {
      held.current = false;
      forgetPersistedCache();
      sweepAccountExports();
      // The editor's unsent changes (#162) are this account's words, not the next person's.
      forgetUnsentEdits();
    }
  }, [signedIn, queryClient]);

  const push = useCallback(() => {
    void pushPendingLocale().then((saved) => {
      // A read that left before the `PATCH` landed would carry the old language; the fresh
      // one agrees with what was just synced, and cancelling the stale one keeps it out.
      if (saved === true) void queryClient.invalidateQueries({ queryKey: ACCOUNT_KEYS.me });
    });
  }, [queryClient]);

  useEffect(() => {
    if (data === null || data === undefined) return;
    const outcome = reconcileWithAccount(data.locale);
    if (outcome.kind === 'apply') {
      // Category names, collection titles and facet labels arrive already translated.
      if (applyAccountLocale(outcome.locale)) void queryClient.invalidateQueries();
    } else if (outcome.kind === 'push') {
      push();
    }
  }, [data, queryClient, push]);

  // Launch, sign-in and unlock: a choice made while the account could not be told.
  useEffect(() => {
    if (canRead) push();
  }, [canRead, push]);

  useEffect(() => {
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: ACCOUNT_KEYS.me });
      void queryClient.invalidateQueries({ queryKey: ACCOUNT_KEYS.unread });
    };
    const app = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      refresh();
      // The retry for a `PATCH` that failed offline. Not while the lock is armed and shut:
      // that would be a biometric prompt nobody asked for.
      if (readable.current) push();
    });
    return () => app.remove();
  }, [queryClient, push]);

  return null;
}
