import { NewProjectScreen } from '../../features/editor/new-project-form';

/** Start a project — the web's `/projects/new` (#162). The tab bar's Create and Me's row land here. */
export default NewProjectScreen;

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../components/route-error-boundary';
