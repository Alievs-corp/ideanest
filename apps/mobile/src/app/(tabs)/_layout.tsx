import { Pressable, StyleSheet, View } from 'react-native';
import { Link, Tabs } from 'expo-router';
import { WithOfflineBanner } from '../../components/offline-banner';
import { TabIcon, type TabIconName } from '../../components/tab-icon';
import { Meta } from '../../components/text';
import { useT } from '../../lib/i18n';
import { badgeText, useSessionState, useUnreadCount } from '../../lib/account';
import { colors, radius, size, spacing } from '../../theme';

/**
 * The five tabs — issue #150.
 *
 * <h2>Icons only, on purpose</h2>
 *
 * The tab bar draws a glyph and no label. That is a design decision, not an oversight:
 * the bar stays the same height at every font scale and in every one of the four
 * languages. CLAUDE.md §2 still needs an accessible name on an icon-only control, so every
 * tab carries `tabBarAccessibilityLabel` — a screen reader announces "Home, tab, 1 of 5" —
 * and colour is never the only signal: the active glyph is heavier as well as lime.
 *
 * <h2>Five, and the fifth is "Me"</h2>
 *
 * Home, Search, Saved, Pledges and Me. The web's header account menu, settings and footer
 * become the Me tab, so nothing needs a header "Account" link any more. The header keeps
 * one control: "Sign in" while nobody is signed in, mirroring the web header.
 *
 * <h2>The colours are the site's</h2>
 *
 * `--surface-2` bar, `--border` hairline, `--lime-500` when active and `--text-tertiary`
 * otherwise (§2.2 measures the latter at 4.9:1).
 */

const TABS: readonly {
  readonly name: string;
  readonly key: 'home' | 'search' | 'saved' | 'pledges' | 'me';
  readonly icon: TabIconName;
}[] = [
  { name: 'index', key: 'home', icon: 'home' },
  { name: 'search', key: 'search', icon: 'search' },
  { name: 'saved', key: 'saved', icon: 'saved' },
  { name: 'pledges', key: 'pledges', icon: 'pledges' },
  { name: 'me', key: 'me', icon: 'me' },
];

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
        <TabIcon name="bell" color={colors.textPrimary} focused={false} size={24} />
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
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface1 },
        headerTintColor: colors.textPrimary,
        headerShadowVisible: false,
        sceneStyle: { backgroundColor: colors.surface1 },
        tabBarStyle: { backgroundColor: colors.surface2, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.lime500,
        tabBarInactiveTintColor: colors.textTertiary,
        tabBarShowLabel: false,
        headerRight: () => <HeaderAction />,
      }}
      // The offline banner, under the tab's header (`components/offline-banner.tsx`).
      screenLayout={({ children }) => <WithOfflineBanner>{children}</WithOfflineBanner>}
    >
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: t(tab.key),
            tabBarAccessibilityLabel: t(tab.key),
            tabBarIcon: ({ color, focused }) => (
              <TabIcon name={tab.icon} color={color} focused={focused} />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}

/*
 * A throw in the header control or the bar itself: the shared route boundary, with "Try
 * again" and the trace reference (`components/route-error-boundary.tsx`). Each tab screen
 * exports it as well, so a failure inside one tab keeps the bar and the other four.
 */
export { RouteErrorBoundary as ErrorBoundary } from '../../components/route-error-boundary';
