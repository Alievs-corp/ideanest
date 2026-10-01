import { Pressable, StyleSheet } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { X } from 'lucide-react-native';
import { WithOfflineBanner } from '../../components/offline-banner';
import { IconButton, Subheading, useFocusRing } from '../../components/ui';
import { useT } from '../../lib/i18n';
import { colors, radius, size } from '../../theme';

/**
 * The authentication group — sign-in, register, the password reset and the two emailed links
 * (issue #152). The root presents it as one modal over whatever somebody was doing, with no tab
 * bar: signing in is an interruption, not a place, and the swipe that dismisses it is the "not
 * now" it must always offer.
 *
 * <h2>The only chrome</h2>
 *
 * The web's `MinimalShell`: the wordmark, which leaves to Home, and — a phone's addition — a
 * close control, because a modal with no visible way out is a trap for anybody who cannot make
 * the dismiss gesture.
 *
 * <h2>Nothing animates</h2>
 *
 * `docs/motion-system.md` §5 gives authentication no entry or transition motion, so moving between
 * these screens is `animation: 'none'`. They `replace` one another rather than push, which keeps
 * this stack one screen deep: closing always closes the whole modal, and nothing of sign-in is
 * left in history behind it.
 */
export default function AuthLayout() {
  const router = useRouter();
  const t = useT('mobile.auth');

  return (
    <Stack
      screenOptions={{
        animation: 'none',
        headerStyle: { backgroundColor: colors.surface1 },
        headerTintColor: colors.textPrimary,
        headerShadowVisible: false,
        headerBackVisible: false,
        contentStyle: { backgroundColor: colors.surface1 },
        title: '',
        headerLeft: () => <Wordmark label={t('wordmark')} hint={t('wordmarkHint')} />,
        headerRight: () => (
          <IconButton
            icon={X}
            label={t('close')}
            variant="ghost"
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
            testID="auth-close"
          />
        ),
      }}
      // Offline is said before a submit fails on it, as on every other screen with a header.
      screenLayout={({ children }) => <WithOfflineBanner>{children}</WithOfflineBanner>}
    />
  );
}

function Wordmark({ label, hint }: { readonly label: string; readonly hint: string }) {
  const router = useRouter();
  const { ring, onFocus, onBlur } = useFocusRing();
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      accessibilityHint={hint}
      onPress={() => router.dismissTo('/')}
      onFocus={onFocus}
      onBlur={onBlur}
      testID="auth-wordmark"
      style={[styles.wordmark, ring]}
    >
      <Subheading>{label}</Subheading>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wordmark: { minHeight: size.touchTarget, justifyContent: 'center', borderRadius: radius.sm },
});

// A render error in the group's frame stays inside the modal (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../components/route-error-boundary';
