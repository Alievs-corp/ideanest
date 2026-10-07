import { FaqPanel } from '../../../../features/editor/faq/faq-panel';

/** The editor's FAQ tab — the web's `/projects/{id}/edit/faq` (#162). */
export default FaqPanel;

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../../../components/route-error-boundary';
