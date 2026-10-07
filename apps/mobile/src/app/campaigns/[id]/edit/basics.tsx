import { BasicsPanel } from '../../../../features/editor/basics-panel';

/** The editor's Basics tab — the web's `/projects/{id}/edit/basics` (#162). */
export default BasicsPanel;

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../../../components/route-error-boundary';
