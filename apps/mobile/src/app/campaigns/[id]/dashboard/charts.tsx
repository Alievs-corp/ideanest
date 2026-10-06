import { useLocalSearchParams } from 'expo-router';
import { FundingChartsPanel } from '../../../../features/dashboard/charts/charts-panel';

/** The dashboard's Funding and backers panel — the web's `/projects/{id}/dashboard/charts` (#163). */
export default function ChartsRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <FundingChartsPanel projectId={typeof id === 'string' ? id : ''} />;
}

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../../../components/route-error-boundary';
