import { useLocalSearchParams } from 'expo-router';
import { FinancePanel } from '../../../../features/dashboard/finance/finance-panel';
import { withScreenRoot } from '../../../../components/screen-root';

/** The dashboard's Finance panel — the web's `/projects/{id}/dashboard/finance` (#163). */
function FinanceRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <FinancePanel projectId={typeof id === 'string' ? id : ''} />;
}

export default withScreenRoot('dashboard-finance', FinanceRoute);

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../../../components/route-error-boundary';
