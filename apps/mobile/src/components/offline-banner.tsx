import { useEffect, type ReactNode } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, View } from 'react-native';
import { currentlyOnline, subscribeToConnectivity, useOnline } from '../lib/connectivity';
import { useT } from '../lib/i18n';
import { colors, spacing } from '../theme';
import { UpcomingMaintenanceBanner } from './maintenance-banner';
import { InlineAlert } from './ui';

/**
 * The global offline banner — issue #150.
 *
 * <h2>Where it renders: each navigator's `screenLayout`</h2>
 *
 * "Under the header" is a different place on every screen: the tabs draw their header in
 * JavaScript, the root stack's is native, and a modal has its own. A banner positioned by
 * the root would have to know each header's height. `screenLayout` — which both Expo Router's
 * `Stack` and `Tabs` pass to React Navigation — wraps each screen's *content*, and a screen's
 * content starts where its header ends, so the banner lands under whichever header the screen
 * has without measuring any of them.
 *
 * <p>The root stack skips screens whose header is hidden (`headerShown: false`). Those are the
 * tab group — whose own `screenLayout` draws the banner under the tab's header, where a second
 * one from the root would sit above it — and the full-screen failure states, which are not
 * something being read from a cache.
 *
 * <h2>The words are the banner; the stripe is the reminder</h2>
 *
 * It is the kit's warning `InlineAlert` — a stripe, an icon **and** a sentence, never the hue
 * alone (CLAUDE.md §2) — laid across the top of the screen. Screens with cached data keep showing it
 * underneath (`offlineFirst`, `lib/offline.ts`); screens without show their own error.
 *
 * <h2>Announced once, when the connection drops</h2>
 *
 * The outer view is an Android live region (`polite`) that is always mounted and starts empty,
 * so the sentence appearing inside it is a content change TalkBack reads — once, when it
 * appears, and not on a launch that is already online, where it never appears. iOS has no live
 * regions; there {@link OfflineAnnouncer} says it, from one place in the root, so the banners
 * mounted on every screen of the stack do not each announce it. That is why the alert itself is
 * `politeness="off"` although it is a warning: the outer view is the one live region, so the
 * alert must not be a second one nested in it (TalkBack could read the sentence twice), and a
 * warning `InlineAlert` would otherwise announce itself on iOS on every screen in the stack.
 */
export function OfflineBanner() {
  const online = useOnline();
  const t = useT('mobile.offline');
  return (
    <View accessibilityLiveRegion="polite" testID="offline-region">
      {online ? null : (
        <View style={styles.banner}>
          <InlineAlert variant="warning" politeness="off" description={t('banner')} />
        </View>
      )}
    </View>
  );
}

/**
 * A screen's content with the banners above it. What the navigators' `screenLayout` returns.
 *
 * <p>Also the planned-maintenance notice (issue #214, `maintenance-banner.tsx`), under the
 * offline one: "under the header" is the same place for both, for the same reason.
 */
export function WithOfflineBanner({ children }: { readonly children: ReactNode }) {
  return (
    <View style={styles.screen}>
      <OfflineBanner />
      <UpcomingMaintenanceBanner />
      {children}
    </View>
  );
}

/**
 * VoiceOver's half of the announcement. Rendered once, in the root layout.
 *
 * <p>Subscribed to the store rather than rendered from `useOnline`, so what fires is the
 * *transition* from online to offline — not a render, and not the first answer on a launch
 * that is already online. Android is left to the banner's live region; announcing there too
 * would say it twice.
 */
export function OfflineAnnouncer() {
  const message = useT('mobile.offline')('banner');

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    // Re-subscribing when the language changes starts from the present, so it announces nothing.
    let wasOnline = currentlyOnline();
    return subscribeToConnectivity(() => {
      const online = currentlyOnline();
      if (wasOnline && !online) AccessibilityInfo.announceForAccessibility(message);
      wasOnline = online;
    });
  }, [message]);

  return null;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface1 },
  banner: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[2],
    paddingBottom: spacing[2],
    backgroundColor: colors.surface1,
  },
});
