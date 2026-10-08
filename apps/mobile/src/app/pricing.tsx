import { useLocalSearchParams } from 'expo-router';
import { PricingScreen } from '../features/plans/pricing-screen';
import { withScreenRoot } from '../components/screen-root';

/** A campaign id, and nothing that could make the review link point anywhere else. */
const PROJECT_ID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Pricing — the web's `/pricing` (issue #164). See `features/plans/pricing-screen.tsx`.
 *
 * `?from=submit&project=<id>` is what a refused submission adds. The id is only ever a link back to
 * the campaign's review step, never fetched; a value that is not an id is dropped.
 */
function Screen() {
  const { from, project } = useLocalSearchParams<{ from?: string; project?: string }>();
  const fromProjectId = from === 'submit' && typeof project === 'string' && PROJECT_ID.test(project) ? project : undefined;
  return <PricingScreen fromProjectId={fromProjectId} />;
}

export default withScreenRoot('pricing', Screen);

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../components/route-error-boundary';
