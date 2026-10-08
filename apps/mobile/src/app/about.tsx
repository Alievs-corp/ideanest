import { AboutScreen } from '../features/content/static-screens';
import { withScreenRoot } from '../components/screen-root';

/** About — the web's `/about` (issue #164). See `features/content/static-screens.tsx`. */
function Screen() {
  return <AboutScreen />;
}

export default withScreenRoot('about', Screen);

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../components/route-error-boundary';
