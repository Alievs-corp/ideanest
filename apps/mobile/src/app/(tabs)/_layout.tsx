import { Pressable, StyleSheet, View } from 'react-native';
import { Link, Tabs, useRouter } from 'expo-router';
import { WithOfflineBanner } from '../../components/offline-banner';
import { FloatingTabBar, TabBarInsetProvider } from '../../components/tab-bar';
import { TAB_GLYPHS, TabIcon } from '../../components/tab-icon';
import { Meta } from '../../components/text';
import { useT } from '../../lib/i18n';
import { badgeText, useSessionState, useUnreadCount } from '../../lib/account';
import { signInHrefFor } from '../../lib/guard';
import { colors, radius, size, spacing } from '../../theme';

/**
 * The tab group — issues #150 and #276.
 *
 * <h2>Five slots: four tabs and Create</h2>
 *
 * Home · Search · [ + ] · Pledges · Me, drawn by the floating bar (`components/tab-bar.tsx`,
 * `mobile-design` skill §3). The centre is a button that starts a campaign — signed out, through
 * sign-in and back — not a tab. Saved moved into the Me hub (`/saved` is a stack route now), by
 * the skill's overflow rule: no sixth slot, no "More".
 *
 * <h2>Icons only, on purpose</h2>
 *
 * The bar draws a glyph and no label, so it stays the same height at every font scale and in all
 * four languages. Every tab carries `tabBarAccessibilityLabel` from the catalogue, and the active
 * tab changes shape (white capsule, Bold glyph), never colour alone.
 *
 * <p>The header keeps one control: "Sign in" while nobody is signed in, the bell otherwise.
 */

const TABS: readonly {
  readonly name: keyof typeof TAB_GLYPHS;
  readonly key: 'home' | 'search' | 'pledges' | 'me';
}[] = [
  { name: 'index', key: 'home' },
  { name: 'search', key: 'search' },
  { name: 'pledges', key: 'pledges' },
  { name: 'me', key: 'me' },
];

const CREATE_PATH = '/campaigns/new';

const styles = StyleSheet.create({
  signIn: {
    minHeight: size.touchTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing[4],
    borderRadius: radius.full,
  },
  signInPressed: { backgroundColor: colors.surface3 },
  // Same footprint as the bell, so the title does not shift while the session is unknown.
  placeholder: { width: size.touchTarget, height: size.touchTarget },
  bell: {
    width: size.touchTarget,
    height: size.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
  },
  badge: {
    position: 'absolute',
    top: 4,
    right: 2,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: radius.full,
    backgroundColor: colors.lime500,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: colors.textOnLime, fontSize: 11, lineHeight: 14, fontWeight: '700' },
});

/**
 * The header control — the web header's right-hand side.
 *
 * Signed in: the bell with the unread count as a badge (`99+` past ninety-nine, none at
 * zero). Signed out: "Sign in". Unknown (the account has not been read, or the read failed):
 * a blank of the same width, so the title does not jump when the answer arrives.
 */
function HeaderAction() {
  const state = useSessionState();
  const unread = useUnreadCount();
  const t = useT('shell.actions');
  const tHeader = useT('mobile.header');

  if (state === 'unknown') return <View style={styles.placeholder} />;

  if (state === 'signed-out') {
    return (
      <Link href="/sign-in" asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('signIn')}
          style={({ pressed }) => [styles.signIn, pressed && styles.signInPressed]}
        >
          <Meta tone="secondary">{t('signIn')}</Meta>
        </Pressable>
      </Link>
    );
  }

  const badge = unread === undefined ? null : badgeText(unread);
  const label =
    unread === undefined ? t('notifications') : unread > 99 ? tHeader('over') : tHeader('unread', { count: unread });
  return (
    <Link href="/notifications" asChild>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => [styles.bell, pressed && styles.signInPressed]}
      >
        <TabIcon name="bell" color={colors.textPrimary} size={24} />
        {badge === null ? null : (
          <View style={styles.badge} accessibilityElementsHidden importantForAccessibility="no">
            <Meta style={styles.badgeText}>{badge}</Meta>
          </View>
        )}
      </Pressable>
    </Link>
  );
}

export default function TabsLayout() {
  const t = useT('mobile.tabs');
  const tActions = useT('shell.actions');
  const router = useRouter();
  const session = useSessionState();

  const create = () =>
    router.push(session === 'signed-out' ? signInHrefFor(CREATE_PATH) : CREATE_PATH);

  return (
    <TabBarInsetProvider>
      <Tabs
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface1 },
          headerTintColor: colors.textPrimary,
          headerShadowVisible: false,
          sceneStyle: { backgroundColor: colors.surface1 },
          tabBarShowLabel: false,
          headerRight: () => <HeaderAction />,
        }}
        tabBar={(props) => (
          <FloatingTabBar
            {...props}
            glyphs={TAB_GLYPHS}
            createLabel={tActions('startCampaign')}
            onCreate={create}
          />
        )}
        // The offline banner, under the tab's header (`components/offline-banner.tsx`).
        screenLayout={({ children }) => <WithOfflineBanner>{children}</WithOfflineBanner>}
      >
        {TABS.map((tab) => (
          <Tabs.Screen
            key={tab.name}
            name={tab.name}
            options={{ title: t(tab.key), tabBarAccessibilityLabel: t(tab.key) }}
          />
        ))}
      </Tabs>
    </TabBarInsetProvider>
  );
}

/*
 * A throw in the header control or the bar itself: the shared route boundary, with "Try
 * again" and the trace reference (`components/route-error-boundary.tsx`). Each tab screen
 * exports it as well, so a failure inside one tab keeps the bar and the other four.
 */
export { RouteErrorBoundary as ErrorBoundary } from '../../components/route-error-boundary';
