import { WebFallback } from '../components/web-fallback';

export default function Screen() {
  return <WebFallback titleKey="shell.actions.notifications" webPath={'/notifications'} />;
}

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../components/route-error-boundary';
