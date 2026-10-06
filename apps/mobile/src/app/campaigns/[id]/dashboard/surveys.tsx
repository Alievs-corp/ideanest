import { useLocalSearchParams } from 'expo-router';
import { SurveyBuilder } from '../../../../features/dashboard/surveys/survey-builder';

export default function Screen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <SurveyBuilder projectId={id} />;
}

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../../../components/route-error-boundary';
