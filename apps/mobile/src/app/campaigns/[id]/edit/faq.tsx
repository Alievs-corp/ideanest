import { FaqPanel } from '../../../../features/editor/faq/faq-panel';
import { withScreenRoot } from '../../../../components/screen-root';

/** The editor's FAQ tab — the web's `/projects/{id}/edit/faq` (#162). */
export default withScreenRoot('editor-faq', FaqPanel);

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../../../components/route-error-boundary';
