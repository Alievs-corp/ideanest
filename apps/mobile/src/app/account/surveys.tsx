import { Stack } from 'expo-router';
import { SurveysScreen } from '../../features/surveys/survey-list';
import { useT } from '../../lib/i18n';

/** The web's `/account/surveys` (#159): the surveys creators are waiting on, answered in place. */
export default function Screen() {
  const t = useT();
  return (
    <>
      <Stack.Screen options={{ title: t('account.links.surveys.label') }} />
      <SurveysScreen />
    </>
  );
}

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../components/route-error-boundary';
