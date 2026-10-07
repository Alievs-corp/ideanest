import { PrelaunchPanel } from '../../../../features/editor/prelaunch/prelaunch-panel';

/** The editor's Pre-launch tab — the web's `/projects/{id}/edit/prelaunch` (#162). */
export default PrelaunchPanel;

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../../../components/route-error-boundary';
