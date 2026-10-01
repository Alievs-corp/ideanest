import { WebFallback } from '../../components/web-fallback';

/*
 * The category index, on the web until the native screen lands (#154). Home's "See all
 * categories" opens it, so the link already points where #154's screen will be.
 */
export default function Screen() {
  return <WebFallback titleKey="shell.nav.categories" webPath={'/categories'} />;
}

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../components/route-error-boundary';
