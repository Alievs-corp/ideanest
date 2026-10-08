import { BasicsPanel } from '../../../../features/editor/basics-panel';
import { withScreenRoot } from '../../../../components/screen-root';

/** The editor's Basics tab — the web's `/projects/{id}/edit/basics` (#162). */
export default withScreenRoot('editor-basics', BasicsPanel);

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../../../components/route-error-boundary';
