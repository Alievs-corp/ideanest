import { useMemo } from 'react';
import { useRouter } from 'expo-router';

/**
 * Moving between the auth screens, and out of them (issue #152).
 *
 * <p>Between them is always `replace`: the group's stack stays one screen deep, so closing it —
 * the close control, the swipe, a finished sign-in — closes the whole modal, and nothing of
 * sign-in is left in history. `returnTo` travels with sign-in and register, so somebody who went
 * from a guarded screen to register and back still lands where they started.
 */
export function useAuthNavigation() {
  const router = useRouter();
  return useMemo(
    () => ({
      toSignIn(returnTo: string | null = null): void {
        router.replace(
          returnTo === null ? '/sign-in' : { pathname: '/sign-in', params: { returnTo } },
        );
      },
      toRegister(returnTo: string | null = null): void {
        router.replace(
          returnTo === null ? '/register' : { pathname: '/register', params: { returnTo } },
        );
      },
      toResetRequest(): void {
        router.replace('/reset-password');
      },
      /** Out of the modal to Home — the wordmark's and the verify screen's "Home". */
      home(): void {
        router.dismissTo('/');
      },
      /** Out of the modal to a screen of the app, which replaces the modal. */
      leaveTo(path: string): void {
        router.replace(path as never);
      },
    }),
    [router],
  );
}
