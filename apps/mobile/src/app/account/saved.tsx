import { Redirect } from 'expo-router';

/** The web's `/account/saved` is the Saved tab in the app. */
export default function AccountSaved() {
  return <Redirect href="/saved" />;
}

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../components/route-error-boundary';
