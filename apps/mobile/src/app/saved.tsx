import { Stack } from 'expo-router';
import { SavedList } from '../features/account/saved-list';
import { useT } from '../lib/i18n';

/**
 * Saved projects — a row of the Me hub since #276, not a tab: the floating bar has five slots and
 * Saved is the destination the `mobile-design` skill's overflow rule moves into Me. `/saved` and
 * the web's `/account/saved` both land here. See `features/account/saved-list.tsx` (#159).
 */
export default function SavedScreen() {
  const t = useT();
  return (
    <>
      <Stack.Screen options={{ title: t('account.links.saved.label') }} />
      <SavedList />
    </>
  );
}

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../components/route-error-boundary';
