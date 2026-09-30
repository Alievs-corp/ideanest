import { Redirect } from 'expo-router';

/** `/account` was the old account screen; the Me tab replaced it. */
export default function AccountIndex() {
  return <Redirect href="/me" />;
}

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../components/route-error-boundary';
