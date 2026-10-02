import { useCallback } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { forgetPersistedCache } from './offline';
import { unregisterFromPush } from './push';
import { endSession } from './session';

/**
 * Forgets the session on this phone after the service has already ended it — a password change
 * revokes every session, and so does signing this device out from the device list (#161).
 *
 * <p>The push registration goes first, while the access token can still authenticate the call;
 * then the keychain, the in-memory cache and the persisted cache.
 */
export async function endLocalSession(queryClient: QueryClient): Promise<void> {
  try {
    await unregisterFromPush();
  } finally {
    try {
      await endSession();
    } finally {
      // Whatever the keychain did, nothing of this account stays in either cache.
      queryClient.clear();
      forgetPersistedCache();
    }
  }
}

export function useEndLocalSession(): () => Promise<void> {
  const queryClient = useQueryClient();
  return useCallback(() => endLocalSession(queryClient), [queryClient]);
}
