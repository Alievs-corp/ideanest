import { useLocalSearchParams } from 'expo-router';
import { BackerReport } from '../../../../features/dashboard/backers/backer-report';

export default function Screen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <BackerReport projectId={id} />;
}

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../../../components/route-error-boundary';
