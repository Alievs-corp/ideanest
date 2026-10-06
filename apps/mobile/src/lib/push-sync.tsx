import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { queryKeys } from '../api/queries';
import { markNotificationRead } from '../features/notifications/api';
import { ACCOUNT_KEYS, canReadAccount, useSessionState } from './account';
import type { Destination } from './links';
import { syncPushRegistration } from './push';
import { claimResponse, dataOf, pushTapOf } from './push-taps';
import { useSession } from './use-session';

function refreshInbox(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: ACCOUNT_KEYS.unread });
  void client.invalidateQueries({ queryKey: queryKeys.inbox() });
}

/**
 * Push at the root — #160. Renders nothing.
 *
 * <ul>
 *   <li><strong>Registration without a prompt.</strong> The first time this launch knows the
 *       account is signed in (a cold start, or the lock opened), and on every foreground while it
 *       is, {@link syncPushRegistration} registers a phone that already allows notifications and
 *       drops the registration of one whose permission was turned off. Never while signed out or
 *       still unknown: that would be a request with nobody to belong to, or a biometric prompt.
 *       A sign-in during this launch registers through the sign-in flow instead.</li>
 *   <li><strong>A push arriving in the foreground</strong> refreshes the unread count and the
 *       inbox.</li>
 *   <li><strong>A tapped push</strong> opens {@link pushTapOf}'s destination through `onOpen` and,
 *       when the payload names its inbox row, marks it read in the background. The cold-start tap
 *       is handled once, whatever remounts.</li>
 * </ul>
 */
export function PushSync({
  siteHost,
  onOpen,
}: {
  readonly siteHost: string;
  readonly onOpen: (destination: Destination) => void;
}) {
  const client = useQueryClient();
  const state = useSessionState();
  const session = useSession();

  const signedIn = useRef(false);
  const readable = useRef(false);
  const latestOpen = useRef(onOpen);
  useEffect(() => {
    signedIn.current = state === 'signed-in';
    readable.current = canReadAccount(session);
    latestOpen.current = onOpen;
  });

  const decided = useRef(false);
  useEffect(() => {
    if (state === 'unknown' || decided.current) return;
    decided.current = true;
    if (state === 'signed-in') void syncPushRegistration();
  }, [state]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active' || !signedIn.current) return;
      // After the account read the foreground starts, so the registration goes out with a live token.
      void client
        .invalidateQueries({ queryKey: ACCOUNT_KEYS.me }, { cancelRefetch: false })
        .catch(() => undefined)
        .then(() => syncPushRegistration());
    });
    return () => subscription.remove();
  }, [client]);

  useEffect(() => {
    const subscription = Notifications.addNotificationReceivedListener(() => refreshInbox(client));
    return () => subscription.remove();
  }, [client]);

  useEffect(() => {
    let live = true;
    const handle = (response: Notifications.NotificationResponse | null) => {
      if (!live || response === null || !claimResponse(response)) return;
      const tap = pushTapOf(dataOf(response), siteHost);
      if (tap.notificationId !== null && readable.current) {
        void markNotificationRead(tap.notificationId).then(
          () => refreshInbox(client),
          () => undefined,
        );
      }
      if (tap.destination !== null) latestOpen.current(tap.destination);
    };

    void Notifications.getLastNotificationResponseAsync().then(handle, () => undefined);
    const subscription = Notifications.addNotificationResponseReceivedListener(handle);
    return () => {
      live = false;
      subscription.remove();
    };
  }, [client, siteHost]);

  return null;
}
