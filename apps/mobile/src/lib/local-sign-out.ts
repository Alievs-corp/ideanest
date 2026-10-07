import { useCallback } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { sweepAccountExports } from './account-export-files';
import { forgetPersistedCache } from './offline';
import { unregisterFromPush } from './push';
import { endSession } from './session';
import { forgetUnsentEdits } from './unsent-edits';

/**
 * Forgets the session on this phone after the service has already ended it — a password change
 * revokes every session, and so does signing this device out from the device list (#161).
 *
 * <p>Also the app lock's wipe after five wrong PINs (#319), which is why it reaches everything this
 * account left on the phone: the push registration goes first, while the access token can still
 * authenticate the call; then the keychain (the session, the PIN and its counter — `endSession`),
 * the in-memory cache, the persisted cache, the exports and the editor's unsent changes.
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
      sweepAccountExports();
      forgetUnsentEdits();
    }
  }
}

export function useEndLocalSession(): () => Promise<void> {
  const queryClient = useQueryClient();
  return useCallback(() => endLocalSession(queryClient), [queryClient]);
}
