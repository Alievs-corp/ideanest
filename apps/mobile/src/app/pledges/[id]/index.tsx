import { useLocalSearchParams } from 'expo-router';
import { PledgeDetailScreen } from '../../../features/pledges/pledge-detail-screen';

export default function Screen() {
  const { id, payment, raise } = useLocalSearchParams<{ id: string; payment?: string; raise?: string }>();
  return <PledgeDetailScreen key={id} id={id} payment={payment} raise={raise} />;
}

export { RouteErrorBoundary as ErrorBoundary } from '../../../components/route-error-boundary';
