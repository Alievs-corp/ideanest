import { AboutScreen } from '../features/content/static-screens';

/** About — the web's `/about` (issue #164). See `features/content/static-screens.tsx`. */
export default function Screen() {
  return <AboutScreen />;
}

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../components/route-error-boundary';
