import { Stack, useLocalSearchParams } from 'expo-router';
import { ShippingAddressScreen } from '../../../features/fulfilment/shipping-address-screen';
import { useT } from '../../../lib/i18n';
import { withScreenRoot } from '../../../components/screen-root';

function Screen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();
  return (
    <>
      <Stack.Screen options={{ title: t('account.fulfilment.address.title') }} />
      <ShippingAddressScreen key={id} id={id} />
    </>
  );
}

export default withScreenRoot('pledge-address', Screen);

export { RouteErrorBoundary as ErrorBoundary } from '../../../components/route-error-boundary';
