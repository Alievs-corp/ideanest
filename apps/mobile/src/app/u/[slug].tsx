import { useLocalSearchParams } from 'expo-router';
import { WebFallback } from '../../components/web-fallback';

/** A public profile — the Me tab's identity row lands here. Web-only until the profile issue. */
export default function Screen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  return (
    <WebFallback
      titleKey="account.links.profile.label"
      webPath={`/u/${encodeURIComponent(slug)}`}
    />
  );
}

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../components/route-error-boundary';
