import { useCallback, useEffect, useMemo, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { siteUrl } from '../api/config';
import { OfflineAnnouncer, WithOfflineBanner } from '../components/offline-banner';
import { SheetHost } from '../components/ui/sheet';
import { SharedTransitionHost } from '../components/ui/shared-transition';
import { sweepAccountExports } from '../lib/account-export-files';
import { startConnectivity } from '../lib/connectivity';
import { destinationFor, type Destination } from '../lib/links';
import { deferUntilUp } from '../lib/maintenance';
import { useMaintenanceGate } from '../lib/maintenance-gate';
import { watchUpcoming } from '../lib/upcoming-maintenance';
import { createQueryClient, persistOptions } from '../lib/offline';
import { lockNow } from '../lib/session';
import { AccountSync } from '../lib/account-sync';
import { PushSync } from '../lib/push-sync';
import { AppIntlProvider } from '../lib/i18n';
import { colors } from '../theme';

/**
 * The root of the application — §14.3.
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
 * `PersistQueryClientProvider` rather than the plain one is the whole of §4.12 MB-04's
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
 * deep links (§4.12 MB-02) most often meet.
 *
 * <h2>The re-lock is here for the same reason — nothing else sees the process</h2>
 *
 * The biometric gate (§4.12 MB-03) fires when the refresh token is read, and the access token it
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

/*
 * A throw in this layout — in a provider, before any screen exists — lands here, outside every
 * provider this file sets up. `components/root-failure.tsx` explains what it can and cannot use.
 * A throw inside a screen never gets this far: each route exports its own boundary.
 */
export { RootFailure as ErrorBoundary } from '../components/root-failure';

/** True when a push asked for the shared-element fade (`ProjectCard`'s `transition: 'shared'`). */
function sharedPush(params: object | undefined): boolean {
  return (params as { transition?: unknown } | undefined)?.transition === 'shared';
}

/**
 * The root stack; inside the intl provider so the screens it presents are translated.
 *
 * <p>Pushes slide in with depth — `mobile-design` skill §6.3: the incoming page from the right,
 * the outgoing one shifting back and dimming. `ios_from_right` is the platform push on iOS, edge
 * swipe included, and the same motion on Android. The modal and full-screen routes below name
 * their own animation, so this one never reaches them.
 */
function AppStack() {
  // Pushes `maintenance` when the service is away (`lib/maintenance-gate.ts`).
  useMaintenanceGate(useRouter());
  return (
    <Stack
      screenOptions={{
        animation: 'ios_from_right',
        headerStyle: { backgroundColor: colors.surface1 },
        headerTintColor: colors.textPrimary,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.surface1 },
      }}
      /*
       * The offline banner under each screen's header. Not on a screen with no header:
       * that is the tab group, which draws its own under the tabs' header, or a
       * full-screen failure state. See `components/offline-banner.tsx`.
       */
      screenLayout={({ children, options }) =>
        options.headerShown === false ? children : <WithOfflineBanner>{children}</WithOfflineBanner>
      }
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      {/*
        No header and no swipe: the screens underneath are the ones that just
        failed, and the way back to them is the service answering. A full-screen
        modal, so it covers a sheet that was open (sign-in) as well as a card.
      */}
      <Stack.Screen
        name="maintenance"
        options={{
          presentation: 'fullScreenModal',
          headerShown: false,
          gestureEnabled: false,
          animation: 'fade',
        }}
      />
      {/*
        A modal, because signing in is an interruption of whatever somebody
        was doing rather than a place they navigated to — and because the
        swipe that dismisses it is the "not now" these screens must always
        offer. Nothing on this platform requires an account to be useful.
        The group draws its own header: `app/(auth)/_layout.tsx`.
      */}
      <Stack.Screen
        name="(auth)"
        options={{ presentation: 'modal', headerShown: false, animation: 'default' }}
      />
      {/*
        A campaign opened from a card fades in while the card's cover flies to the page's cover
        (`SharedTransition`): the cover is what moves, and a page sliding under it would measure
        the landing frame mid-slide. Opened any other way, it pushes with depth like everything else.
      */}
      <Stack.Screen
        name="projects/[creatorSlug]/[projectSlug]"
        options={({ route }) => (sharedPush(route.params) ? { animation: 'fade' } : {})}
      />
      <Stack.Screen
        name="campaigns/[id]/back"
        options={{ presentation: 'fullScreenModal', headerShown: false, animation: 'none' }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  const router = useRouter();
  const host = useMemo(() => new URL(siteUrl()).host, []);
  const leftAt = useRef<number | null>(null);

  // The offline banner's source, and TanStack Query's (`lib/connectivity.ts`).
  useEffect(() => startConnectivity(), []);

  // An account export Android could not delete when its share sheet returned (#161).
  useEffect(() => sweepAccountExports(), []);

  // The planned-maintenance banner's source: `/v1/status` on launch and on return (#214).
  useEffect(() => watchUpcoming(), []);

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

  const go = useCallback(
    (destination: Destination) => {
      const push = () =>
        router.push(
          (destination.params === undefined
            ? destination.pathname
            : { pathname: destination.pathname, params: destination.params }) as never,
        );
      // During maintenance the link waits for the service (`deferUntilUp`), then opens.
      if (!deferUntilUp(push)) push();
    },
    [router],
  );

  useEffect(() => {
    let live = true;

    const open = (url: string | null) => {
      if (!live || url === null) return;
      const destination = destinationFor(url, host);
      // `null` means "a link this application does not claim". Doing nothing is
      // the answer: Expo Router has already shown the launch route, and sending
      // somebody to the feed instead would make a bad link look like a good one.
      if (destination !== null) go(destination);
    };

    void Linking.getInitialURL().then(open);
    const subscription = Linking.addEventListener('url', (event) => open(event.url));

    /*
     * A tapped push notification arrives at the same parser, by `PushSync` (`lib/push-sync.tsx`):
     * a notification tap does not go through `Linking` on either platform, and a push with no
     * destination opens the inbox where a shared link would stay put.
     */

    return () => {
      live = false;
      subscription.remove();
    };
  }, [go, host]);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.surface1 }}>
      <SafeAreaProvider>
        <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions()}>
          {/* Light glyphs: every surface in this system is dark (docs/ui-kit.md §2.1). */}
          <AppIntlProvider>
            <StatusBar style="light" />
            <AccountSync />
            <PushSync siteHost={host} onOpen={go} />
            <OfflineAnnouncer />
            {/* The page a white sheet rises over scales back under it (`ui/sheet.tsx`, #277). */}
            {/* Card → page flights are drawn above everything (`ui/shared-transition.tsx`, #279). */}
            <SharedTransitionHost>
              <SheetHost>
                <AppStack />
              </SheetHost>
            </SharedTransitionHost>
          </AppIntlProvider>
        </PersistQueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
