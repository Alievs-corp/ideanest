import { NotificationSettingsScreen } from '../../features/settings/notifications/preferences-screen';
import { withScreenRoot } from '../../components/screen-root';

export default withScreenRoot('settings-notifications', NotificationSettingsScreen);

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../components/route-error-boundary';
