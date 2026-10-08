import { useLocalSearchParams } from 'expo-router';
import { OverviewScreen } from '../../../../features/dashboard/overview/overview-screen';
import { withScreenRoot } from '../../../../components/screen-root';

/** The dashboard's Overview — the web's `/projects/[id]/dashboard` (#163). */
function Screen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <OverviewScreen projectId={id} />;
}

export default withScreenRoot('dashboard', Screen);

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../../../components/route-error-boundary';
