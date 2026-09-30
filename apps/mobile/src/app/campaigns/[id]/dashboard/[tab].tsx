import { useLocalSearchParams } from 'expo-router';
import { WebFallback } from '../../../../components/web-fallback';

export default function Screen() {
  const { id, tab } = useLocalSearchParams<{ id: string; tab: string }>();
  return <WebFallback titleKey="dashboard.meta.title" webPath={`/projects/${encodeURIComponent(id)}/dashboard/${encodeURIComponent(tab)}`} />;
}

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../../../components/route-error-boundary';
