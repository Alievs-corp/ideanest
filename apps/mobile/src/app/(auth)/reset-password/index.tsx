import { AuthScreen } from '../../../features/auth/auth-screen';
import { ResetRequestForm } from '../../../features/auth/reset-request-form';

/**
 * Ask for a reset link — the web's `/[locale]/reset-password` (issue #152). Also where the
 * "registration on an existing account" and "password changed" emails land: their link has no
 * token.
 */
export default function ResetPasswordScreen() {
  return (
    <AuthScreen>
      <ResetRequestForm />
    </AuthScreen>
  );
}

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../../components/route-error-boundary';
