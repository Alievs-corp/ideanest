import { Pressable, StyleSheet } from 'react-native';
import { Link, Tabs, type ErrorBoundaryProps } from 'expo-router';
import { FailureState } from '../../components/failure-state';
import { TabIcon, type TabIconName } from '../../components/tab-icon';
import { Meta } from '../../components/text';
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
  readonly title: string;
  readonly icon: TabIconName;
}[] = [
  { name: 'index', title: 'Home', icon: 'home' },
  { name: 'search', title: 'Search', icon: 'search' },
  { name: 'saved', title: 'Saved', icon: 'saved' },
  { name: 'pledges', title: 'Pledges', icon: 'pledges' },
  { name: 'me', title: 'Me', icon: 'me' },
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
  if (signedIn) return null;
  return (
    <Link href="/sign-in" asChild>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Sign in"
        style={({ pressed }) => [styles.signIn, pressed && styles.signInPressed]}
      >
        <Meta tone="secondary">Sign in</Meta>
      </Pressable>
    </Link>
  );
}

export default function TabsLayout() {
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
            title: tab.title,
            tabBarAccessibilityLabel: tab.title,
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
  return (
    <FailureState
      title="Something went wrong"
      description="The page could not be shown. Try again."
      actionLabel="Try again"
      onAction={() => void retry()}
    />
  );
}
