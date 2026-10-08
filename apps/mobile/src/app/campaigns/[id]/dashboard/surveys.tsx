import { useLocalSearchParams } from 'expo-router';
import { SurveyBuilder } from '../../../../features/dashboard/surveys/survey-builder';
import { withScreenRoot } from '../../../../components/screen-root';

function Screen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <SurveyBuilder projectId={id} />;
}

export default withScreenRoot('dashboard-surveys', Screen);

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../../../components/route-error-boundary';
