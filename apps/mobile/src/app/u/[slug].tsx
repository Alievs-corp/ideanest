import { useLocalSearchParams } from 'expo-router';
import { ProfileScreen } from '../../features/profile/profile-screen';

/**
 * A public profile — web `/u/{slug}` (#156). The screen is `features/profile/profile-screen.tsx`;
 * `?tab=` keeps the open tab for state restoration. The Creator tab and the Me tab link here.
 */
export default function Screen() {
  const { slug, tab } = useLocalSearchParams<{ slug: string; tab?: string }>();
  return <ProfileScreen slug={slug} tab={tab} />;
}

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../components/route-error-boundary';
