import { TrustSafetyScreen } from '../features/content/static-screens';

/** Trust and safety — the web's `/trust-safety` (issue #164). */
export default function Screen() {
  return <TrustSafetyScreen />;
}

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../components/route-error-boundary';
