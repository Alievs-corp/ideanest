import { useCallback } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { sweepAccountExports } from './account-export-files';
import { tellServiceSignedOut } from './auth';
import { forgetPersistedCache } from './offline';
import { unregisterFromPush } from './push';
import { currentAccessToken, endSession, storedRefreshToken } from './session';
import { forgetUnsentEdits } from './unsent-edits';

/**
 * Forgets the session on this phone — after a password change (which revokes every session), when
 * this device is signed out from the device list (#161), and as the app lock's wipe after five
 * wrong PINs and "Forgot your PIN?" (#319).
 *
 * <h2>The phone first, the network after, and never waited for</h2>
 *
 * The keychain goes first (the session, the PIN and its counter — `endSession`), then the
 * in-memory cache, the persisted cache, the exports and the editor's unsent changes. Only then is
 * the service told, and nothing here waits for it: the push registration is dropped with the
 * access token taken before the wipe, and the refresh token, read before the wipe, is revoked with
 * `POST /v1/auth/logout`. A slow or absent network must never leave this account's data on the
 * phone a moment longer — the wipe after five wrong PINs runs with somebody else holding it.
 */
export async function endLocalSession(queryClient: QueryClient): Promise<void> {
  const bearer = currentAccessToken();
  const refreshToken = await storedRefreshToken();
  try {
    await endSession();
  } finally {
    // Whatever the keychain did, nothing of this account stays in either cache.
    queryClient.clear();
    forgetPersistedCache();
    sweepAccountExports();
    forgetUnsentEdits();
    // Best effort, unawaited: both swallow their own failures.
    void unregisterFromPush(bearer);
    if (refreshToken !== null) void tellServiceSignedOut(refreshToken);
  }
}

export function useEndLocalSession(): () => Promise<void> {
  const queryClient = useQueryClient();
  return useCallback(() => endLocalSession(queryClient), [queryClient]);
}
