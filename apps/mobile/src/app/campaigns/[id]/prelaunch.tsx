import { useLocalSearchParams } from 'expo-router';
import { PrelaunchScreen } from '../../../components/prelaunch/prelaunch-screen';

/**
 * A campaign's public pre-launch page — the web's `/projects/{id}/prelaunch`, issue #155.
 *
 * Under `campaigns/` because Expo Router cannot hold `projects/[id]` beside the campaign page's
 * `projects/[creatorSlug]`; `lib/links.ts` maps the web address here. Public: no session guard
 * (`lib/guard.ts` lists only the creator's screens), because the people this page collects have
 * usually never signed up.
 */
export default function PrelaunchRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <PrelaunchScreen projectId={typeof id === 'string' ? id : ''} />;
}

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../../components/route-error-boundary';
