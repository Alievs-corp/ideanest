import { HowItWorksScreen } from '../features/content/static-screens';

/** How it works — the web's `/how-it-works` (issue #164). */
export default function Screen() {
  return <HowItWorksScreen />;
}

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../components/route-error-boundary';
