import { SessionsSettingsScreen } from '../../features/settings/sessions/sessions-screen';
import { withScreenRoot } from '../../components/screen-root';

export default withScreenRoot('settings-sessions', SessionsSettingsScreen);

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../components/route-error-boundary';
