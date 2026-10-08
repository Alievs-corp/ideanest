import { HowItWorksScreen } from '../features/content/static-screens';
import { withScreenRoot } from '../components/screen-root';

/** How it works — the web's `/how-it-works` (issue #164). */
function Screen() {
  return <HowItWorksScreen />;
}

export default withScreenRoot('how-it-works', Screen);

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../components/route-error-boundary';
