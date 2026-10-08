import { PrelaunchPanel } from '../../../../features/editor/prelaunch/prelaunch-panel';
import { withScreenRoot } from '../../../../components/screen-root';

/** The editor's Pre-launch tab — the web's `/projects/{id}/edit/prelaunch` (#162). */
export default withScreenRoot('editor-prelaunch', PrelaunchPanel);

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../../../components/route-error-boundary';
