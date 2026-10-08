import { ReviewPanel } from '../../../../features/editor/review/review-panel';
import { withScreenRoot } from '../../../../components/screen-root';

/** The editor's Review tab — the web's `/projects/{id}/edit/review` (#162). */
export default withScreenRoot('editor-review', ReviewPanel);

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../../../components/route-error-boundary';
