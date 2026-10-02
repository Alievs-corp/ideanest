import { useLocalSearchParams } from 'expo-router';
import { PayoutSettingsScreen } from '../../features/settings/payout/payout-details';

export default function Screen() {
  const { card } = useLocalSearchParams<{ card?: string }>();
  return <PayoutSettingsScreen card={card} />;
}

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../components/route-error-boundary';
