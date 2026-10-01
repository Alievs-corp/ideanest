import { useLocalSearchParams } from 'expo-router';
import { AuthScreen } from '../../features/auth/auth-screen';
import { RegisterForm } from '../../features/auth/register-form';
import { safeReturnTo } from '../../lib/guard';

/**
 * Create an account — the web's `/[locale]/register`, in the auth modal (issue #152).
 *
 * <p>`returnTo` travels from sign-in and back to it, sanitised the same way, so a person sent here
 * from a guarded screen still lands on it after the email is verified and they sign in.
 */
export default function RegisterScreen() {
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  return (
    <AuthScreen>
      <RegisterForm returnTo={safeReturnTo(returnTo)} />
    </AuthScreen>
  );
}

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../components/route-error-boundary';
