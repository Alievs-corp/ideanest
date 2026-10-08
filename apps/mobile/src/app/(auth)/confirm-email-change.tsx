import { AuthScreen } from '../../features/auth/auth-screen';
import { EmailChangeView } from '../../features/auth/email-change-view';
import { useLinkToken } from '../../features/auth/link-token';
import { withScreenRoot } from '../../components/screen-root';

/**
 * Confirm a new email address — the web's `/[locale]/confirm-email-change?token=`, opened from
 * the new mailbox (issue #152). Public: the reader may not be signed in on this phone.
 */
function ConfirmEmailChangeScreen() {
  const token = useLinkToken();
  return (
    <AuthScreen>
      <EmailChangeView key={token} token={token} />
    </AuthScreen>
  );
}

export default withScreenRoot('confirm-email-change', ConfirmEmailChangeScreen);

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../components/route-error-boundary';
