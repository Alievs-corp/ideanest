import { useLocalSearchParams } from 'expo-router';
import { WebFallback } from '../../components/web-fallback';

/** The pledge, where checkout lands after paying — a placeholder until #158 draws it here. */
export default function Screen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <WebFallback titleKey="account.pages.pledgeDetail.title" webPath={`/pledges/${encodeURIComponent(id)}`} />;
}

export { RouteErrorBoundary as ErrorBoundary } from '../../components/route-error-boundary';
