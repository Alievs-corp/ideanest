import { LegalIndexScreen } from '../../features/legal/legal-screens';

/** The legal index — the web's `/legal` (issue #164). See `features/legal/legal-screens.tsx`. */
export default function Screen() {
  return <LegalIndexScreen />;
}

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../components/route-error-boundary';
