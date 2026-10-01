import { useLocalSearchParams } from 'expo-router';
import { CampaignScreen } from '../../../components/campaign/campaign-screen';

/**
 * The campaign page — web `/projects/{creatorSlug}/{projectSlug}` (#155). The screen is
 * `components/campaign/campaign-screen.tsx`, outside `src/app` so its tests can sit beside it
 * without Expo Router offering them as routes. `?tab=` and `?thread=` are read there.
 */
export default function ProjectScreen() {
  const { creatorSlug, projectSlug } = useLocalSearchParams<{
    creatorSlug: string;
    projectSlug: string;
  }>();
  return <CampaignScreen creatorSlug={creatorSlug} projectSlug={projectSlug} />;
}

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../../components/route-error-boundary';
