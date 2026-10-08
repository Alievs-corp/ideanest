import { Stack } from 'expo-router';
import { DeliveriesScreen } from '../../features/fulfilment/delivery-list';
import { useT } from '../../lib/i18n';
import { withScreenRoot } from '../../components/screen-root';

/** The web's `/account/deliveries` (#159): where each reward this account is owed is. */
function Screen() {
  const t = useT();
  return (
    <>
      <Stack.Screen options={{ title: t('account.links.deliveries.label') }} />
      <DeliveriesScreen />
    </>
  );
}

export default withScreenRoot('account-deliveries', Screen);

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../components/route-error-boundary';
