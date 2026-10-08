import { ProfileSettingsScreen } from '../../features/settings/profile/profile-screen';
import { withScreenRoot } from '../../components/screen-root';

export default withScreenRoot('settings-profile', ProfileSettingsScreen);

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../components/route-error-boundary';
