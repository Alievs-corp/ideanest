import { useLocalSearchParams } from 'expo-router';
import { AuthHeader, AuthScreen } from '../../features/auth/auth-screen';
import { AuthLink } from '../../features/auth/auth-link';
import { useAuthNavigation } from '../../features/auth/navigation';
import { SignInForm } from '../../features/auth/sign-in-form';
import { safeReturnTo } from '../../lib/guard';
import { useT } from '../../lib/i18n';
import { withScreenRoot } from '../../components/screen-root';

/**
 * Sign in — the web's `/[locale]/sign-in`, in the auth modal (issue #152).
 *
 * <p>`returnTo` is where a guarded screen sent somebody from (`lib/guard.ts`), sanitised by the
 * web's rules so a crafted link cannot steer past sign-in to anywhere. `notice` is read as one
 * fixed value or nothing: no text on this screen ever comes from a link.
 *
 * <p>The form, its refusals and the second factor are `features/auth/sign-in-form.tsx`'s.
 */
function SignInScreen() {
  const t = useT('auth.signIn');
  const navigate = useAuthNavigation();
  const { returnTo, notice } = useLocalSearchParams<{ returnTo?: string; notice?: string }>();
  const safe = safeReturnTo(returnTo);

  return (
    <AuthScreen>
      <AuthHeader title={t('title')} intro={t('intro')} />
      <SignInForm
        returnTo={safe}
        notice={notice}
        footer={
          <>
            <AuthLink label={t('forgot')} onPress={() => navigate.toResetRequest()} />
            <AuthLink
              prompt={t('noAccount')}
              label={t('createOne')}
              onPress={() => navigate.toRegister(safe)}
            />
          </>
        }
      />
    </AuthScreen>
  );
}

export default withScreenRoot('sign-in', SignInScreen);

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../components/route-error-boundary';
