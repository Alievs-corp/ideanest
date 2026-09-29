import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useQueryClient } from '@tanstack/react-query';
import { isLocale } from '@ideanest/messages';
import { ACCOUNT_KEYS, useMe } from './account';
import { setLocale } from './locale';
import { useSession } from './use-session';

/**
 * Keeps the shell's picture of the account current — issue #150. Renders nothing.
 *
 * - **Account language.** Rule 2 of `lib/locale.ts`: once per account per launch, the
 *   language the account chose overwrites the stored choice, as the web's `SessionProvider`
 *   does with its cookie. Once, not on every refetch: a refetch that landed between a
 *   language tap and its `PATCH` would otherwise switch the app back.
 * - **Foreground and push.** Coming back to the app, and a push arriving while it is open,
 *   refresh the account and the unread count.
 */
export function AccountSync() {
  const queryClient = useQueryClient();
  const { data } = useMe();
  const { signedIn } = useSession();
  const applied = useRef<string | null>(null);

  // Whatever ends the session — sign-out, a revoked token, a 401 elsewhere — the next person
  // to sign in must not see this account's name or badge from the cache.
  useEffect(() => {
    if (signedIn) return;
    queryClient.removeQueries({ queryKey: ACCOUNT_KEYS.me });
    queryClient.removeQueries({ queryKey: ACCOUNT_KEYS.unread });
    applied.current = null;
  }, [signedIn, queryClient]);

  useEffect(() => {
    if (data === null || data === undefined) {
      applied.current = null;
      return;
    }
    if (data.id === undefined || applied.current === data.id) return;
    applied.current = data.id;
    if (isLocale(data.locale)) setLocale(data.locale);
  }, [data]);

  useEffect(() => {
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: ACCOUNT_KEYS.me });
      void queryClient.invalidateQueries({ queryKey: ACCOUNT_KEYS.unread });
    };
    const app = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    const push = Notifications.addNotificationReceivedListener(() => {
      void queryClient.invalidateQueries({ queryKey: ACCOUNT_KEYS.unread });
    });
    return () => {
      app.remove();
      push.remove();
    };
  }, [queryClient]);

  return null;
}
