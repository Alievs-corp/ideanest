import { TrustSafetyScreen } from '../features/content/static-screens';
import { withScreenRoot } from '../components/screen-root';

/** Trust and safety — the web's `/trust-safety` (issue #164). */
function Screen() {
  return <TrustSafetyScreen />;
}

export default withScreenRoot('trust-safety', Screen);

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../components/route-error-boundary';
