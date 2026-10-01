import { AuthScreen } from '../../features/auth/auth-screen';
import { useLinkToken } from '../../features/auth/link-token';
import { VerifyEmailView } from '../../features/auth/verify-email-view';

/**
 * Verify an email address — the web's `/[locale]/verify-email?token=`, opened from the
 * registration email (issue #152). The token is read once and taken off the route.
 */
export default function VerifyEmailScreen() {
  const token = useLinkToken();
  return (
    <AuthScreen>
      <VerifyEmailView key={token} token={token} />
    </AuthScreen>
  );
}

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../components/route-error-boundary';
