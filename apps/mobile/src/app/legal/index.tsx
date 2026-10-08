import { LegalIndexScreen } from '../../features/legal/legal-screens';
import { withScreenRoot } from '../../components/screen-root';

/** The legal index — the web's `/legal` (issue #164). See `features/legal/legal-screens.tsx`. */
function Screen() {
  return <LegalIndexScreen />;
}

export default withScreenRoot('legal', Screen);

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../components/route-error-boundary';
