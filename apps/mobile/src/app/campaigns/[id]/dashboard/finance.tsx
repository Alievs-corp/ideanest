import { useLocalSearchParams } from 'expo-router';
import { FinancePanel } from '../../../../features/dashboard/finance/finance-panel';

/** The dashboard's Finance panel — the web's `/projects/{id}/dashboard/finance` (#163). */
export default function FinanceRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <FinancePanel projectId={typeof id === 'string' ? id : ''} />;
}

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../../../components/route-error-boundary';
