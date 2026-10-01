import { NotFoundState } from '../components/not-found-state';

/**
 * Where an unmatched route lands.
 *
 * It exists because a link this application does not have a screen for is not
 * rare — every campaign link is shared with people whose copy is older than the
 * route it names. `lib/links.ts` refuses a link from a host we do not claim
 * before it gets here; what reaches this screen is one of ours that this build
 * does not know about, and the useful thing to offer is the way back rather than
 * an apology. The browse routes draw the same screen for a slug that names
 * nothing (#154), so both are `NotFoundState`.
 */
export default function NotFoundScreen() {
  return <NotFoundState />;
}

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../components/route-error-boundary';
