import { SecuritySettingsScreen } from '../../features/settings/security-screen';
import { withScreenRoot } from '../../components/screen-root';

export default withScreenRoot('settings-security', SecuritySettingsScreen);

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../components/route-error-boundary';
