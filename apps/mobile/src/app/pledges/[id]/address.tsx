import { useLocalSearchParams } from 'expo-router';
import { WebFallback } from '../../../components/web-fallback';

export default function Screen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <WebFallback
      titleKey="account.fulfilment.address.title"
      webPath={`/pledges/${encodeURIComponent(id)}/address`}
    />
  );
}

export { RouteErrorBoundary as ErrorBoundary } from '../../../components/route-error-boundary';
