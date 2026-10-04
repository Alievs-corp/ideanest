import { Redirect } from 'expo-router';

/** The web's `/account/saved` is the Me hub's Saved screen in the app (`app/saved.tsx`). */
export default function AccountSaved() {
  return <Redirect href="/saved" />;
}

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../components/route-error-boundary';
