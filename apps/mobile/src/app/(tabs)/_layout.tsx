import { Pressable, StyleSheet } from 'react-native';
import { Link, Tabs, type ErrorBoundaryProps } from 'expo-router';
import { FailureState } from '../../components/failure-state';
import { TabIcon, type TabIconName } from '../../components/tab-icon';
import { Meta } from '../../components/text';
import { useT } from '../../lib/i18n';
import { useSession } from '../../lib/use-session';
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
});

/** The header control while signed out. Nothing at all when signed in. */
function SignInLink() {
  const { signedIn } = useSession();
  const t = useT('shell.actions');
  if (signedIn) return null;
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
        headerRight: () => <SignInLink />,
      }}
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

/** A render error under the tabs: try again, never a stack trace. */
export function ErrorBoundary({ retry }: ErrorBoundaryProps) {
  const t = useT('shell.failure.pages.error');
  return (
    <FailureState
      title={t('title')}
      description={t('description')}
      actionLabel={t('retry')}
      onAction={() => void retry()}
    />
  );
}
