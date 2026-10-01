import { useCallback, useState } from 'react';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { ACCOUNT_KEYS } from '../../lib/account';
import type { SignInOutcome } from '../../lib/auth';
import { registerIfAllowed } from '../../lib/push';

/**
 * What happens after a sign-in answer — the web's `useSignInOutcome`, shared by the password,
 * Google and Apple paths (issue #152).
 *
 * <h2>One `settle`, so a provider cannot skip the second factor</h2>
 *
 * Each path ends in a {@link SignInOutcome}, and each hands it here. A challenge becomes the
 * two-factor step; a session becomes {@link finish}. Three paths with three copies of that branch
 * is how one of them comes to treat a challenge as a session.
 *
 * <h2>Leaving</h2>
 *
 *   - The tokens are already adopted (`lib/auth.ts`), so `use-session` has published the change
 *     and the screen underneath has redrawn by the time it is visible.
 *   - Push is re-registered only where notifications are ALREADY allowed: signing in never puts a
 *     permission prompt on screen (#160 owns asking).
 *   - `GET /v1/me` is asked for again, so Me shows the account that just arrived.
 *   - With a `returnTo`, the auth modal is replaced by it; without one it is dismissed back to where
 *     the person was. Either way nothing of sign-in is left in history.
 */
export interface PendingChallenge {
  readonly value: string;
  readonly expiresInSeconds: number;
}

export function useSignInOutcome(returnTo: string | null) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [challenge, setChallenge] = useState<PendingChallenge | null>(null);

  const finish = useCallback(async () => {
    // Neither is awaited: a slow push service or account read must not hold somebody on a
    // sign-in screen they have already completed, and neither can fail the sign-in.
    void registerIfAllowed().catch(() => undefined);
    void queryClient.invalidateQueries({ queryKey: ACCOUNT_KEYS.me });

    if (returnTo !== null) router.replace(returnTo as never);
    else if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [queryClient, returnTo, router]);

  const settle = useCallback(
    async (outcome: SignInOutcome) => {
      if (outcome.kind === 'two-factor') {
        setChallenge({ value: outcome.challenge, expiresInSeconds: outcome.expiresInSeconds });
        return;
      }
      await finish();
    },
    [finish],
  );

  const clearChallenge = useCallback(() => setChallenge(null), []);

  return { challenge, settle, finish, clearChallenge };
}
