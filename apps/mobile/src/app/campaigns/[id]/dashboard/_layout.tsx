import { DashboardFrame } from '../../../../features/dashboard/dashboard-frame';

/** The creator dashboard's frame (#163): the header, the five tabs, and the panel below them. */
export default DashboardFrame;

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../../../components/route-error-boundary';
