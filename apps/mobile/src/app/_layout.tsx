import { useEffect, useMemo, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { siteUrl } from '../api/config';
import { destinationFor } from '../lib/links';
import { createQueryClient, persistOptions } from '../lib/offline';
import { lockNow } from '../lib/session';
import { AccountSync } from '../lib/account-sync';
import { AppIntlProvider, useT } from '../lib/i18n';
import { colors } from '../theme';

/**
 * The root of the application — issue #110.
 *
 * <h2>What lives here and why nothing else does</h2>
 *
 * Four providers, in an order that is not arbitrary. `GestureHandlerRootView`
 * has to be the outermost native view or a gesture started in a child never
 * reaches the handler. `SafeAreaProvider` measures the insets every screen below
 * reads, and measuring them twice — which is what a second provider deeper in
 * the tree does — gives half the screens the wrong answer on a device with a
 * notch.
 *
 * `PersistQueryClientProvider` rather than the plain one is the whole of #115's
 * wiring: it restores the cache before the first render and writes it back as
 * queries settle. See `lib/offline.ts` for what it will and will not keep.
 *
 * <h2>The link handler is here because a cold start has no screen yet</h2>
 *
 * Expo Router resolves an incoming URL to a route on its own. What it does not
 * do is refuse one, and on Android any application can send an implicit intent
 * carrying a URL. `lib/links.ts` decides; this listens. Both entry points are
 * covered — `getInitialURL` for the launch that started the process, and the
 * `url` event for a link that arrives while the application is already open —
 * because a link that works only when the app is already running is the bug
 * #114 is most often filed about.
 *
 * <h2>The re-lock is here for the same reason — nothing else sees the process</h2>
 *
 * #29's gate fires when the refresh token is read, and the access token it
 * produces then lives in memory for fifteen minutes. A phone handed to somebody
 * else inside that window reaches the pledge list without a prompt. `AppState`
 * is the only signal that the application was put away, and the root is the only
 * place with one listener rather than one per screen.
 */

/**
 * How long the application may be away before the gate re-arms.
 *
 * <p>Long enough that answering a message or checking a boarding pass does not
 * cost a prompt, short enough that a phone left on a table is closed. Below
 * `AppState` fires on notification shades and control centres on both platforms
 * as well, so a threshold of zero would prompt for pulling down a notification.
 */
const RELOCK_AFTER_MS = 2 * 60 * 1000;

const queryClient = createQueryClient();

/** The tabs are always the base of the stack, so a guarded deep link has somewhere to go back to. */
export const unstable_settings = { initialRouteName: '(tabs)' };

/**
 * The link inside a push payload, or null when there is not one.
 *
 * <p>`PushComposer` puts exactly one key in `data`, and a payload from anywhere else has
 * no business steering this application — so anything that is not a string is dropped
 * here, and anything that is still has to survive `destinationFor`.
 */
function urlFromNotification(
  response: Notifications.NotificationResponse | null,
): string | null {
  const data = response?.notification.request.content.data;
  const url = (data as { url?: unknown } | undefined)?.url;
  return typeof url === 'string' ? url : null;
}

/** The root stack; inside the intl provider so its screen titles are translated. */
function AppStack() {
  const t = useT();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface1 },
        headerTintColor: colors.textPrimary,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.surface1 },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      {/*
        A modal, because signing in is an interruption of whatever somebody
        was doing rather than a place they navigated to — and because the
        swipe that dismisses it is the "not now" this screen must always
        offer. Nothing on this platform requires an account to be useful.
      */}
      <Stack.Screen
        name="sign-in"
        options={{ presentation: 'modal', title: t('shell.actions.signIn') }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  const router = useRouter();
  const host = useMemo(() => new URL(siteUrl()).host, []);
  const leftAt = useRef<number | null>(null);

  useEffect(() => {
    const changed = (state: AppStateStatus) => {
      if (state === 'active') {
        const away = leftAt.current;
        leftAt.current = null;
        /*
         * `lockNow` is a no-op when the lock is off, so this costs nothing on a
         * phone that never turned it on. Date.now() rather than a clock from
         * anywhere: this measures wall time across a suspension, which is the
         * one thing a monotonic timer inside a suspended process cannot.
         */
        if (away !== null && Date.now() - away >= RELOCK_AFTER_MS) lockNow();
        return;
      }
      // `background` on both platforms, and `inactive` on iOS for the app
      // switcher and an incoming call. The first of the two is what to
      // remember: going inactive then background must not reset the clock.
      leftAt.current ??= Date.now();
    };

    const subscription = AppState.addEventListener('change', changed);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    let live = true;

    const open = (url: string | null) => {
      if (!live || url === null) return;
      const destination = destinationFor(url, host);
      // `null` means "a link this application does not claim". Doing nothing is
      // the answer: Expo Router has already shown the launch route, and sending
      // somebody to the feed instead would make a bad link look like a good one.
      if (destination !== null) router.push(destination.pathname as never);
    };

    void Linking.getInitialURL().then(open);
    const subscription = Linking.addEventListener('url', (event) => open(event.url));

    /*
     * A tapped push notification — issue #87, arriving at #114's parser.
     *
     * It is a separate subscription rather than a second `url` event, because a
     * notification tap does not go through `Linking` on either platform: the payload's
     * `data.url` is ours, put there by `PushComposer`, and the operating system hands it
     * over as a response object. Routing it through `destinationFor` means a campaign
     * opened from a notification and one opened from a shared link land on the same
     * screen by the same code — which is the whole of what #114 asks for, and what stops
     * the two drifting into "works from a link, does nothing from a notification".
     *
     * `getLastNotificationResponseAsync` covers the cold start: a tap that launched the
     * process has already happened by the time this effect runs, and only this call
     * reports it.
     */
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      open(urlFromNotification(response));
    });
    const tapped = Notifications.addNotificationResponseReceivedListener((response) => {
      open(urlFromNotification(response));
    });

    return () => {
      live = false;
      subscription.remove();
      tapped.remove();
    };
  }, [host, router]);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.surface1 }}>
      <SafeAreaProvider>
        <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions()}>
          {/* Light glyphs: every surface in this system is dark (docs/ui-kit.md §2.1). */}
          <AppIntlProvider>
            <StatusBar style="light" />
            <AccountSync />
            <AppStack />
          </AppIntlProvider>
        </PersistQueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
