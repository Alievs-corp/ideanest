import { useLocalSearchParams } from 'expo-router';
import { WebFallback } from '../../components/web-fallback';

export default function Screen() {
  const { section } = useLocalSearchParams<{ section: string }>();
  return <WebFallback titleKey="account.groups.yourAccount" webPath={`/account/${encodeURIComponent(section)}`} />;
}

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../components/route-error-boundary';
