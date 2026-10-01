import { AuthScreen } from '../../../features/auth/auth-screen';
import { useLinkToken } from '../../../features/auth/link-token';
import { ResetConfirmForm } from '../../../features/auth/reset-confirm-form';

/**
 * Choose a new password — the web's `/[locale]/reset-password/confirm?token=`, opened from the
 * reset email (issue #152). The token is read once and taken off the route (`useLinkToken`).
 */
export default function ResetPasswordConfirmScreen() {
  const token = useLinkToken();
  return (
    <AuthScreen>
      <ResetConfirmForm key={token} token={token} />
    </AuthScreen>
  );
}

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../../components/route-error-boundary';
