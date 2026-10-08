import { PasswordSettingsScreen } from '../../features/settings/password-change';
import { withScreenRoot } from '../../components/screen-root';

export default withScreenRoot('settings-password', PasswordSettingsScreen);

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../components/route-error-boundary';
