import { Stack } from 'expo-router';
import { FollowingList } from '../../features/account/following-list';
import { useT } from '../../lib/i18n';

/** Following — the web's `/account/following` (#159). See `features/account/following-list.tsx`. */
export default function Screen() {
  const t = useT();
  return (
    <>
      <Stack.Screen options={{ title: t('account.links.following.label') }} />
      <FollowingList />
    </>
  );
}

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../components/route-error-boundary';
