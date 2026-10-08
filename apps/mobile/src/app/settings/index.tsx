import { SettingsListScreen } from '../../features/settings/settings-list';
import { withScreenRoot } from '../../components/screen-root';

export default withScreenRoot('settings', SettingsListScreen);

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../components/route-error-boundary';
