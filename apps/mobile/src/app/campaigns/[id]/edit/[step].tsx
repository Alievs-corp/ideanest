import { useLocalSearchParams } from 'expo-router';
import { WebFallback } from '../../../../components/web-fallback';

export default function Screen() {
  const { id, step } = useLocalSearchParams<{ id: string; step: string }>();
  return <WebFallback titleKey="mobile.fallback.editCampaign" webPath={`/projects/${encodeURIComponent(id)}/edit/${encodeURIComponent(step)}`} />;
}

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../../../components/route-error-boundary';
